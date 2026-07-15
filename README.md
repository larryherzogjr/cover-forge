# Cover Forge

A self-hosted generator for Amazon KDP **full-wrap** book covers — back, spine,
and front in one print-ready file, with the spine/bleed/safe-margin math and the
ISBN/barcode keep-clear area handled automatically.

Built to replace per-cover SaaS tools for someone who publishes a lot. No
accounts, no subscription, no stock-photo upsell — runs on your own server.

## Status

Working. The frontend is a **modular static app** (vanilla JS + Canvas, ES
modules — no build step) in `web/`; a small Flask API in `server/` covers the two
browser-impossible features (background removal, print-grade PDF). Implemented:

- **Paperback and hardcover** full-wrap geometry (spine/bleed/wrap/safe/hinge),
  live 2D preview with guides, 3D preview, exact 300-DPI pixel dims.
- Background image (opacity, blend, pan/zoom) plus solid/gradient fills, palette
  extraction, and **overlay/logo layers**.
- A curated **18-family cover-font catalog**, shared by every text block and
  loaded before raster export.
- Front title/author/subtitle/series/pull-quote and back tagline/bio with full
  type controls (stroke, tracking, line-height, caps, shadow, pasteable hex
  colors), **free
  drag-positioning** + keyboard nudging, spine text, and a back blurb that flows
  around the barcode zone.
- **Pre-flight** effective-DPI and CMYK-shift warnings plus rendered safe-area
  and barcode-zone collision checks.
- Export: **print PDF** (RGB or CMYK, via the API), print-wrap PNG, ebook front.
- **Project save/load** (portable JSON) + autosave, one-click blank-cover reset,
  and undo/redo.

> ES modules need an HTTP origin, so the app no longer opens from `file://` —
> serve `web/` over HTTP (below).

## Quick start

```bash
# Frontend — serve web/ over HTTP, then open the printed URL
cd web && python3 -m http.server 8080   # http://localhost:8080

# API (PDF export; background removal needs rembg on a GPU box)
cd server && python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
flask --app app run --port 5004 --debug

# Frontend geometry/state/pre-flight tests + syntax checks
cd web && npm test
cd web && npm run check

# API regression tests
cd server && python -m unittest -v
```

There is no frontend build step. The checked-in ES modules are served directly.
Core Python dependency versions are constrained by `server/constraints.txt`;
GPU-specific rembg/onnx versions remain host-dependent.

## Docs

- `CLAUDE.md` — guidance for Claude Code (architecture, invariants, conventions).
- `HANDOFF.md` — full context: what's done, why, what's left.
- `docs/KDP_SPEC.md` — verified print geometry and constants (the source of truth
  for the math). Always cross-check Amazon's calculator and a printed proof.
- `docs/ROADMAP.md` — prioritized task backlog (GitHub-issue ready).
- `docs/DEPLOYMENT.md` — server deploy (Flask + gunicorn + systemd + nginx).

## License

[MIT](LICENSE).

## Disclaimer

Output must be verified against KDP's own cover calculator and a physical proof
before a print run. Print is CMYK; on-screen colors (especially saturated navy
and gold) shift on press.
