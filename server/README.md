# Cover Forge API

Small Flask service for the two features that can't run in the browser.

## Endpoints

| Method | Path | Purpose | Status |
|--------|------|---------|--------|
| GET  | `/api/health`    | liveness | done (stub) |
| POST | `/api/remove-bg` | isolate subject (rembg/BiRefNet) | stub: echoes input |
| POST | `/api/export-pdf`| 300-DPI render -> print PDF | stub: returns 501 |

See contracts (request/response shapes) in the docstrings in `app.py`.

## Dev

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
flask --app app run --port 5004 --debug
curl -s http://127.0.0.1:5004/api/health
```

## Implementation notes

- **remove-bg:** lazy-import the model and load it once at module scope; don't
  reload per request. Run on the GPU box with `onnxruntime-gpu`. Pre-warm on
  startup. Return RGBA PNG.
- **export-pdf:** start simple (Pillow + img2pdf), exact physical page size,
  TrimBox inset by bleed. CMYK via ImageCms + an ICC profile. PDF/X-1a via
  Ghostscript only if KDP rejects the simpler output. Validate output dims == the
  requested wrap dims.
- **Config via env:** `CF_PORT`, `CF_ALLOWED_ORIGIN`, `CF_MAX_UPLOAD_MB`. Never
  hardcode origins or secrets.

## Prod

`gunicorn -w 2 -b 127.0.0.1:5004 --timeout 120 app:app` behind nginx; see
`../docs/DEPLOYMENT.md` and `../deploy/`.
