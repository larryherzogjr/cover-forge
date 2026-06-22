# Cover Forge API

Small Flask service for the two features that can't run in the browser.

## Endpoints

| Method | Path | Purpose | Status |
|--------|------|---------|--------|
| GET  | `/api/health`    | liveness | done |
| POST | `/api/remove-bg` | isolate subject (rembg) | done (503 if rembg absent) |
| POST | `/api/export-pdf`| 300-DPI render -> print PDF | done (RGB + CMYK) |

See contracts (request/response shapes) in the docstrings in `app.py`.

## Dev

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
flask --app app run --port 5004 --debug
curl -s http://127.0.0.1:5004/api/health
```

## Implementation notes

- **remove-bg:** done — lazy `from rembg import remove` + a cached `new_session`
  (model via `CF_REMBG_MODEL`, default `u2net`). Returns an RGBA PNG, or `503`
  with a clear message if rembg/onnxruntime aren't installed (the frontend
  degrades gracefully). rembg is heavy and commented out of `requirements.txt`;
  install it on the GPU box with `onnxruntime-gpu` and pre-warm on startup.
- **export-pdf:** done — Pillow + img2pdf, exact physical page size (MediaBox),
  TrimBox inset by bleed, RGB embedded losslessly. `cmyk:true` converts via
  `ImageCms` + the `CF_CMYK_ICC` profile when set, else a naive Pillow
  conversion; the mode is returned in `X-CMYK-Mode` (`icc`/`naive`/`none`) and
  `X-Dim-Match` flags whether the upload matched `round(in*300)`. PDF/X-1a via
  Ghostscript remains optional — see `docs/DEPLOYMENT.md`.
- **Config via env:** `CF_PORT`, `CF_ALLOWED_ORIGIN`, `CF_MAX_UPLOAD_MB`,
  `CF_CMYK_ICC` (path to a CMYK ICC profile), `CF_REMBG_MODEL` (rembg model
  name). Never hardcode origins or secrets.

## Prod

`gunicorn -w 2 -b 127.0.0.1:5004 --timeout 120 app:app` behind nginx; see
`../docs/DEPLOYMENT.md` and `../deploy/`.
