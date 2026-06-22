# Cover Forge

A self-hosted generator for Amazon KDP **full-wrap** book covers — back, spine,
and front in one print-ready file, with the spine/bleed/safe-margin math and the
ISBN/barcode keep-clear area handled automatically.

Built to replace per-cover SaaS tools for someone who publishes a lot. No
accounts, no subscription, no stock-photo upsell — runs on your own server.

## Status

`web/index.html` is a **working single-file prototype** (no dependencies — open
it in a browser). It does trim/spine/bleed math, a live 2D wrap preview with
guides, a 3D preview, background image with opacity + pan/zoom, palette
extraction, front title/author, spine text (with orientation flip), a back-cover
blurb that flows around the barcode zone, and PNG export at exact 300-DPI dims.

The repo is set up to grow this into a proper app: a modular static frontend plus
a small Flask API for the two browser-impossible features (background removal and
print-grade PDF export).

## Quick start

```bash
# Frontend (the prototype works standalone)
cd web && python3 -m http.server 8080   # http://localhost:8080
# or just open web/index.html

# API (scaffold)
cd server && python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
flask --app app run --port 5004 --debug
```

## Docs

- `CLAUDE.md` — guidance for Claude Code (architecture, invariants, conventions).
- `HANDOFF.md` — full context: what's done, why, what's left.
- `docs/KDP_SPEC.md` — verified print geometry and constants (the source of truth
  for the math). Always cross-check Amazon's calculator and a printed proof.
- `docs/ROADMAP.md` — prioritized task backlog (GitHub-issue ready).
- `docs/DEPLOYMENT.md` — server deploy (Flask + gunicorn + systemd + nginx).

## License

Add one before publishing (MIT is a fine default for a personal tool).

## Disclaimer

Output must be verified against KDP's own cover calculator and a physical proof
before a print run. Print is CMYK; on-screen colors (especially saturated navy
and gold) shift on press.
