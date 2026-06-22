# Deployment

Mirrors the owner's existing pattern (Flask app under `/opt`, gunicorn, systemd,
nginx reverse proxy on Proxmox). The frontend is static; the API is a small Flask
service. Background removal should run where the GPU is.

## Layout on the server

```
/opt/cover-forge/
  web/        # static frontend (served by nginx)
  server/     # Flask API (gunicorn under systemd)
  .venv/      # python venv for the API
```

## Ports

- API: **5004** (Sermon Broadcaster uses 5003; the old Whisper appliance used
  5005 — 5004 is free). Bind to 127.0.0.1; nginx proxies it.
- Frontend: served by nginx (80/443) on its own vhost or a subpath.

## API service (systemd + gunicorn)

```bash
cd /opt/cover-forge/server
python3 -m venv ../.venv && . ../.venv/bin/activate
pip install -r requirements.txt
```

Install `deploy/cover-forge-api.service`, then:

```bash
sudo cp /opt/cover-forge/deploy/cover-forge-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cover-forge-api
systemctl status cover-forge-api
curl -s http://127.0.0.1:5004/api/health
```

## nginx

Use `deploy/nginx-cover-forge.conf` (adjust `server_name` and TLS). It serves
`web/` statically and proxies `/api/` to gunicorn. Set the API's CORS origin to
the real site origin via the `CF_ALLOWED_ORIGIN` env var (in the unit file) so
it isn't `*` in production.

```bash
sudo cp /opt/cover-forge/deploy/nginx-cover-forge.conf /etc/nginx/sites-available/cover-forge
sudo ln -s /etc/nginx/sites-available/cover-forge /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## Background removal placement

`rembg`/BiRefNet wants the GPU. Two options:
1. Run the whole API on the GPU box (simplest) and proxy to it from nginx.
2. Keep the API on the app VM and have `/api/remove-bg` forward to a tiny
   inference service on the GPU box. Choose based on where you want the Flask
   app to live; document the choice in `server/README.md`.

Install `onnxruntime-gpu` (not the CPU wheel) on the GPU box and pre-warm the
model on service start so the first request isn't slow.

## PDF / CMYK notes

- The simple path (Pillow + img2pdf) yields a correct-dimension RGB or CMYK PDF.
- For strict **PDF/X-1a**, post-process with Ghostscript and a PDFX def file:
  `gs -dPDFX -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -sOutputFile=out.pdf PDFX_def.ps in.pdf`
  Embed an appropriate CMYK ICC profile. Only worth it if KDP flags the simpler
  PDFs; start simple.

## CI (optional, recommended)

A minimal GitHub Action: run `node --check` on the extracted frontend JS and
`python -m compileall server/` on push. Add `pytest` once `kdp.js` logic has a
Python or Node test mirror.
