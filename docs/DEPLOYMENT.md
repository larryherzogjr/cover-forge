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

## Single-process (no nginx) — serve everything from Flask

Simplest option, and the one to use when the box already runs apps on direct
ports (e.g. llama.cpp on :3000). One gunicorn process serves the static `web/`
**and** `/api/*` on a single LAN port — same origin, no CORS, no nginx. The Flask
app auto-serves `web/` whenever it finds it next to `server/` (override/disable
with `CF_WEB_DIR`).

```bash
sudo mkdir -p /opt/cover-forge && sudo chown "$USER" /opt/cover-forge
gh repo clone <owner>/cover-forge /opt/cover-forge
cd /opt/cover-forge/server
python3 -m venv ../.venv && . ../.venv/bin/activate
pip install -r requirements.txt
pip install "rembg[gpu]"          # background removal; or onnxruntime (CPU), or skip
# NB: rembg[gpu] pulls onnxruntime-gpu built for a specific CUDA. If you get
# "libcudart.so.NN: cannot open shared object file", the box's CUDA doesn't
# match — either install that CUDA runtime, or fall back to CPU:
#   pip uninstall -y onnxruntime onnxruntime-gpu && pip install onnxruntime
# (CPU rembg is a few seconds per cover — fine for occasional use.)
# serve on the LAN like llama.cpp:
../.venv/bin/gunicorn -w 2 -b 0.0.0.0:5004 --timeout 120 app:app
```

Open `http://<box>:5004/`. The frontend resolves its API calls to the same
origin automatically (any port except 8080). For a service, use
`deploy/cover-forge-api.service` with the `0.0.0.0:5004` `ExecStart` (commented in
the file). Bound to `0.0.0.0` it's reachable on the LAN (like llama.cpp on
:3000); add a `ufw` rule if you want to restrict who can reach it.

## Split layout: frontend VM + API on the inference (GPU) box

This is the recommended layout when background removal runs on a separate
machine (rembg/onnxruntime are heavy and want the GPU). The browser still talks
to **one origin** (the VM), so there's no CORS:

```
browser ──> Proxmox VM : nginx ──serves──> web/ (static)
                              └─proxy /api/─> inference box : gunicorn :5004 (Flask + rembg)
```

**On the inference box (API):**

```bash
sudo mkdir -p /opt/cover-forge && cd /opt/cover-forge
# copy the repo's server/ here (git clone, scp, or rsync), then:
cd server && python3 -m venv ../.venv && . ../.venv/bin/activate
pip install -r requirements.txt
pip install rembg onnxruntime          # or onnxruntime-gpu if CUDA is set up
```

- In `deploy/cover-forge-api.service`, switch `ExecStart` to the `0.0.0.0:5004`
  bind (commented in the file) so the VM can reach it, then install + start it
  (see "API service" below).
- **Firewall** port 5004 to just the VM, e.g.:
  `sudo ufw allow from <VM-IP> to any port 5004 proto tcp` (don't leave it open
  to the whole LAN).
- Pre-warm the model after start so the first real request isn't slow:
  `curl -s -o /dev/null -F image=@/path/to/any.png http://127.0.0.1:5004/api/remove-bg`
  (the first call downloads the model to `~/.u2net/`).

**On the Proxmox VM (frontend + proxy):**

```bash
sudo apt install nginx
sudo mkdir -p /opt/cover-forge && # copy the repo's web/ to /opt/cover-forge/web
```

- Use `deploy/nginx-cover-forge.conf`, but set `proxy_pass http://<inference-box-IP>:5004;`
  in the `/api/` block (commented note in the file). nginx serves `web/`
  statically and proxies `/api/` across to the inference box.
- No CORS config is needed (the browser only ever sees the VM origin); leave
  `CF_ALLOWED_ORIGIN` at the site origin or `*` since `/api` is reached server-
  to-server.

If you'd rather not run nginx at all, the simplest single-box option is to serve
everything from the inference box's Flask process (it already runs there) — but
that needs Flask to serve `web/` statically, which the API doesn't do yet; the
nginx front door above is the supported path.

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
  This is implemented in `/api/export-pdf`: MediaBox = exact wrap, TrimBox inset
  by bleed, RGB embedded losslessly.
- **CMYK** (`cmyk:true` in the request): if `CF_CMYK_ICC` points to a CMYK ICC
  profile the server does a proper `ImageCms` sRGB→CMYK transform; otherwise it
  falls back to Pillow's naive `convert("CMYK")`. The mode is returned in the
  `X-CMYK-Mode` response header (`icc` | `naive` | `none`) and surfaced to the
  user. Set `CF_CMYK_ICC=/path/to/USWebCoatedSWOP.icc` (or similar) in the unit
  file for accurate output.
- For strict **PDF/X-1a**, post-process with Ghostscript and a PDFX def file:
  `gs -dPDFX -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -sOutputFile=out.pdf PDFX_def.ps in.pdf`
  Embed an appropriate CMYK ICC profile. Only worth it if KDP flags the simpler
  PDFs; start simple.

## CI (optional, recommended)

A minimal GitHub Action: run `node --check` on the extracted frontend JS and
`python -m compileall server/` on push. Add `pytest` once `kdp.js` logic has a
Python or Node test mirror.
