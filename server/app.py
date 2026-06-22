"""
Cover Forge API — the two features that can't run in the browser:
  POST /api/remove-bg   -> isolate a subject (rembg / BiRefNet)
  POST /api/export-pdf  -> wrap a 300-DPI render into a print-ready PDF

This is a SCAFFOLD. Endpoints define the contract and return sensible stubs so
the frontend can be wired immediately; fill in the TODOs. Keep heavy model
imports lazy so the app boots without them during early development.

Run (dev):   flask --app app run --port 5004 --debug
Run (prod):  gunicorn -w 2 -b 127.0.0.1:5004 app:app   (see deploy/)
"""
import base64
import io
import os

from flask import Flask, abort, jsonify, request, send_file, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
# Lock this down to the actual frontend origin in production (see DEPLOYMENT.md).
# Expose the custom headers so the browser can read them cross-origin (dev: the
# static site and the API are on different ports).
CORS(app, resources={r"/api/*": {
    "origins": os.environ.get("CF_ALLOWED_ORIGIN", "*"),
    "expose_headers": ["X-CMYK-Mode", "X-Dim-Match"],
}})

MAX_UPLOAD_MB = int(os.environ.get("CF_MAX_UPLOAD_MB", "25"))
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

DPI = 300  # KDP print resolution; must match the frontend render (docs/KDP_SPEC.md)

# Optionally serve the static frontend from this same process, so the whole app
# runs on one port/origin with no separate web server (set CF_WEB_DIR to override,
# or to "" to disable and run API-only behind nginx). See docs/DEPLOYMENT.md.
_default_web = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
WEB_DIR = os.path.abspath(os.environ.get("CF_WEB_DIR", _default_web))
SERVE_WEB = bool(WEB_DIR) and os.path.isdir(WEB_DIR)


@app.get("/api/health")
def health():
    return jsonify(status="ok", service="cover-forge-api", version="0.1.0")


_REMBG_SESSION = None  # cached model session (loaded once, lazily)


def _rembg_session():
    """Load the rembg model session once and reuse it. CF_REMBG_MODEL selects
    the model (default u2net; u2netp is smaller, isnet-general-use is sharper)."""
    global _REMBG_SESSION
    if _REMBG_SESSION is None:
        from rembg import new_session  # heavy import — lazy
        _REMBG_SESSION = new_session(os.environ.get("CF_REMBG_MODEL", "u2net"))
    return _REMBG_SESSION


@app.post("/api/remove-bg")
def remove_bg():
    """
    Input:  multipart/form-data with field 'image' (PNG/JPG), OR
            JSON {"image_base64": "<data without data: prefix>"}.
    Output: image/png (RGBA) with the background removed.

    Uses rembg (lazy import + cached session). rembg/onnxruntime are heavy and
    intended for the GPU box (see docs/DEPLOYMENT.md); if they aren't installed
    the endpoint returns 503 with a clear message so the frontend can degrade.
    """
    data = _read_image_bytes(request)
    if data is None:
        return jsonify(error="no image provided (field 'image' or 'image_base64')"), 400

    try:
        from rembg import remove  # lazy import
    except (Exception, SystemExit):
        # rembg calls sys.exit(1) (SystemExit, not Exception) when its onnxruntime
        # import fails, so catch both — a missing/broken runtime must degrade to 503.
        return jsonify(
            error="background removal is not available on this server",
            detail="rembg/onnxruntime not importable — install a matching onnxruntime (CPU, or GPU build for this box's CUDA); see docs/DEPLOYMENT.md",
        ), 503

    try:
        out = remove(data, session=_rembg_session())  # PNG bytes (RGBA)
    except Exception as e:  # model/runtime failure
        return jsonify(error="background removal failed", detail=str(e)), 500

    return send_file(io.BytesIO(out), mimetype="image/png", download_name="cutout.png")


@app.post("/api/export-pdf")
def export_pdf():
    """
    Input (JSON):
      {
        "png_base64": "<full-resolution 300-DPI wrap PNG, no data: prefix>",
        "width_in":  12.745,      # full wrap width  (inches)
        "height_in": 9.25,        # full wrap height (inches)
        "bleed_in":  0.125,
        "cmyk":      false        # true -> convert to CMYK (needs ICC profile)
      }
    Output: application/pdf — one page, MediaBox = full wrap at exact size,
            TrimBox inset by bleed, image placed at 300 DPI.

    Implemented with Pillow + img2pdf (lossless, no recompression of the RGB
    render). MediaBox is pinned to the exact wrap size; TrimBox is inset by the
    bleed. cmyk=true converts via an ICC profile when CF_CMYK_ICC is set, else a
    naive Pillow conversion (flagged in the X-CMYK-Mode response header). For the
    strictest PDF/X-1a, post-process with Ghostscript — see docs/DEPLOYMENT.md.
    """
    import img2pdf
    from PIL import Image, ImageCms

    payload = request.get_json(silent=True) or {}
    b64 = payload.get("png_base64") or ""
    if not b64:
        return jsonify(error="png_base64 required"), 400
    if "," in b64[:64] and b64.lstrip().startswith("data:"):
        b64 = b64.split(",", 1)[1]  # tolerate a data: URL prefix
    try:
        png_bytes = base64.b64decode(b64)
    except Exception:
        return jsonify(error="png_base64 is not valid base64"), 400

    try:
        width_in = float(payload.get("width_in"))
        height_in = float(payload.get("height_in"))
    except (TypeError, ValueError):
        return jsonify(error="width_in and height_in (inches) are required"), 400
    if not (0 < width_in <= 60 and 0 < height_in <= 60):
        return jsonify(error="width_in/height_in out of range"), 400
    bleed_in = float(payload.get("bleed_in", 0.125))
    want_cmyk = bool(payload.get("cmyk", False))

    try:
        img = Image.open(io.BytesIO(png_bytes))
        img.load()
    except Exception:
        return jsonify(error="png_base64 did not decode to a valid image"), 400

    # Sanity: the render should be ~300 DPI for the requested wrap. Warn (don't
    # block) if it's well off — the page size below is authoritative regardless.
    exp_w, exp_h = round(width_in * DPI), round(height_in * DPI)
    dim_ok = abs(img.width - exp_w) <= 2 and abs(img.height - exp_h) <= 2

    cmyk_mode = "none"
    embed_bytes = png_bytes  # default: embed the RGB PNG verbatim (lossless)
    if want_cmyk:
        icc = os.environ.get("CF_CMYK_ICC")
        rgb = img.convert("RGB")
        if icc and os.path.exists(icc):
            src = ImageCms.createProfile("sRGB")
            dst = ImageCms.getOpenProfile(icc)
            cmyk_img = ImageCms.profileToProfile(rgb, src, dst, outputMode="CMYK")
            cmyk_mode = "icc"
        else:
            cmyk_img = rgb.convert("CMYK")  # naive built-in transform
            cmyk_mode = "naive"
        cbuf = io.BytesIO()
        cmyk_img.save(cbuf, format="TIFF", compression="tiff_lzw")
        embed_bytes = cbuf.getvalue()

    # MediaBox = exact wrap; TrimBox inset by bleed on all sides; BleedBox = media.
    layout = img2pdf.get_layout_fun(
        (img2pdf.in_to_pt(width_in), img2pdf.in_to_pt(height_in))
    )
    tb = img2pdf.in_to_pt(bleed_in)
    out = io.BytesIO()
    img2pdf.convert(
        embed_bytes,
        outputstream=out,
        layout_fun=layout,
        trimborder=(tb, tb),
        bleedborder=(0, 0),
        title="Cover Forge wrap {:.3f}x{:.3f}in".format(width_in, height_in),
        nodate=True,  # reproducible output
    )
    out.seek(0)

    name = "kdp-wrap_{:.3g}x{:.3g}_{}.pdf".format(width_in, height_in,
                                                  "cmyk" if want_cmyk else "rgb")
    resp = send_file(out, mimetype="application/pdf", download_name=name)
    resp.headers["X-CMYK-Mode"] = cmyk_mode
    resp.headers["X-Dim-Match"] = "ok" if dim_ok else "off"
    return resp


def _read_image_bytes(req):
    if "image" in req.files:
        return req.files["image"].read()
    js = req.get_json(silent=True) or {}
    b64 = js.get("image_base64")
    if b64:
        try:
            return base64.b64decode(b64)
        except Exception:
            return None
    return None


# --- static frontend (single-origin deploy: this process serves web/ too) ---
if SERVE_WEB:
    @app.get("/")
    def _index():
        return send_from_directory(WEB_DIR, "index.html")

    @app.get("/<path:path>")
    def _static(path):
        # never let the catch-all shadow the API (explicit /api rules match first,
        # but guard unknown /api/* so it 404s instead of probing the filesystem)
        if path == "api" or path.startswith("api/"):
            abort(404)
        return send_from_directory(WEB_DIR, path)


if __name__ == "__main__":
    app.run(host=os.environ.get("CF_HOST", "127.0.0.1"),
            port=int(os.environ.get("CF_PORT", "5004")), debug=True)
