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

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

app = Flask(__name__)
# Lock this down to the actual frontend origin in production (see DEPLOYMENT.md).
CORS(app, resources={r"/api/*": {"origins": os.environ.get("CF_ALLOWED_ORIGIN", "*")}})

MAX_UPLOAD_MB = int(os.environ.get("CF_MAX_UPLOAD_MB", "25"))
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024


@app.get("/api/health")
def health():
    return jsonify(status="ok", service="cover-forge-api", version="0.1.0")


@app.post("/api/remove-bg")
def remove_bg():
    """
    Input:  multipart/form-data with field 'image' (PNG/JPG), OR
            JSON {"image_base64": "<data without data: prefix>"}.
    Output: image/png (RGBA) with the background removed.

    TODO: implement with rembg (simplest) or a BiRefNet ONNX session on the
    local GPU box. Keep the model load module-level + lazy so repeated calls
    don't reload it. Example with rembg:

        from rembg import remove          # lazy import inside the function
        out = remove(input_bytes)         # returns PNG bytes (RGBA)
    """
    data = _read_image_bytes(request)
    if data is None:
        return jsonify(error="no image provided (field 'image' or 'image_base64')"), 400

    # --- STUB: echo the input back unchanged so the frontend can be wired. ---
    # Replace this whole block with the real rembg/BiRefNet call.
    return send_file(io.BytesIO(data), mimetype="image/png", download_name="cutout.png")


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

    TODO: implement. Simplest correct path with Pillow + img2pdf:

        from PIL import Image
        img = Image.open(io.BytesIO(png_bytes))
        # Optional CMYK: img = img.convert('CMYK')  # better: ImageCms with an ICC profile
        # Place at exact physical size; set DPI so the PDF size is right.
        pdf_bytes = ...  # img2pdf.convert(..., pagesize=(width_in*72, height_in*72))

    For the strictest PDF/X-1a, post-process with Ghostscript using a PDFX def
    (see docs/DEPLOYMENT.md notes). Validate output dimensions equal the inputs.
    """
    payload = request.get_json(silent=True) or {}
    b64 = payload.get("png_base64")
    if not b64:
        return jsonify(error="png_base64 required"), 400
    try:
        png_bytes = base64.b64decode(b64)
    except Exception:
        return jsonify(error="png_base64 is not valid base64"), 400

    # --- STUB: not implemented yet. Return 501 so the frontend can show a clear
    # "PDF export coming" state instead of a silent failure. ---
    _ = png_bytes
    return jsonify(error="export-pdf not implemented yet", todo="see server/app.py"), 501


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


if __name__ == "__main__":
    app.run(port=int(os.environ.get("CF_PORT", "5004")), debug=True)
