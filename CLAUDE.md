# CLAUDE.md — Cover Forge

Guidance for Claude Code working in this repo. Keep this file current as the
architecture evolves. Read `HANDOFF.md` once for full context; read
`docs/KDP_SPEC.md` before touching any cover-geometry or print math.

## What this is

Cover Forge is a self-hosted, KDP full-wrap book-cover generator. It exists so
the owner (a prolific self-publisher) can stop paying per-cover SaaS fees. The
working prototype is a single self-contained file at `web/index.html` — it is
the **reference implementation**, not the final architecture. Everything it does
must keep working after refactors.

Primary user is the repo owner: deep IT background, runs Flask apps on Proxmox
behind nginx with systemd, has a local GPU box for inference. Deployment should
mirror that pattern (see `docs/DEPLOYMENT.md`). Don't introduce heavy toolchains
without reason.

## Stack & conventions

- **Frontend:** vanilla JS + Canvas 2D, no framework. Target refactor is ES
  modules served statically (no build step required). A bundler (Vite) is
  optional and only if it clearly pays for itself. Do not add React.
- **Backend:** Python 3.11+ / Flask, for the two features that can't run in the
  browser (background removal, print-grade PDF export). Lives in `server/`.
- **No secrets in the repo.** API keys/config via environment variables.
- Keep dependencies lean. Justify every new one.

## Run / dev commands

```bash
# Frontend (any static server; the single file also works from file://)
cd web && python3 -m http.server 8080      # then open http://localhost:8080

# Backend
cd server && python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
flask --app app run --port 5004 --debug

# Syntax-check the prototype's inline JS before committing changes to it
python3 - <<'PY'
import re; s=open('web/index.html').read()
open('/tmp/f.js','w').write(re.search(r'<script>(.*)</script>', s, re.S).group(1))
PY
node --check /tmp/f.js
```

## Architecture (current vs target)

Current: one HTML file. State object `S`, geometry in `dims()`, all drawing in
`drawCover()`, live preview in `render()`, export functions, and event wiring —
all inline. Target module split (first refactor task, see `docs/ROADMAP.md`):

```
web/
  index.html          # shell + DOM only
  src/
    kdp.js            # geometry & constants — PURE functions, unit-tested
    state.js          # the S object + load/save (project JSON)
    render.js         # drawCover, drawImageFit, text/back/spine, guides, 3D
    export.js         # PNG now; calls server for PDF
    ui.js             # event wiring, panels, drag/zoom interactions
    fonts.js          # font list + ensure-loaded-before-export
```

Keep `kdp.js` free of DOM/canvas so it can be tested in Node.

## Domain invariants — DO NOT regress these

These were bugs we already fixed in the prototype. Re-introducing them produces
covers KDP rejects or that print wrong. Guard them with tests where possible.

1. **Fonts are point-based.** `fontPx = sizePt / 72 * pxPerInch`. Never multiply
   by DPI again on top of the px-per-inch scale (the original bug double-counted
   DPI and rendered ~1200px titles on a 550px canvas).
2. **Safe-margin inset is 0.25″ on all four sides.** A safe rectangle's width is
   `trimW - 2*SAFE`, not `trimW - SAFE`. The earlier guide subtracted the margin
   from only one side, so boxes ran into the spine fold / cover edge.
3. **Image transform is resolution-independent.** Pan is stored in **inches**,
   zoom as a unitless multiplier (1 = cover-fit). The preview and the 300-DPI
   export must produce the identical crop. Anything stored in screen pixels is a
   bug.
4. **Back-cover text flows around the ISBN/barcode keep-clear box** (2″×1.2″,
   0.25″ from the lower-right trim, plus a small gutter). This must hold in the
   exported file regardless of whether guide overlays are visible.
5. **Spine text only renders at >= 100 pages** and has an orientation flip
   (top-to-bottom is the US/UK trade convention).
6. **Geometry comes from `docs/KDP_SPEC.md`.** Never hardcode a spine/bleed/wrap
   number inline; reference the constants. When in doubt the authority is KDP's
   own cover calculator, and the user should order a printed proof.

## Visual identity (preserve it)

Navy ink + brass/gold. Chrome type: Space Grotesk (display), Inter (UI), Space
Mono (numeric readouts). The cover-design font menu (Playfair, Cormorant, EB
Garamond, Libre Baskerville, Oswald, Bebas Neue, Montserrat, Archivo Black) is
for the books themselves and is separate from the app chrome. Don't flatten the
tool into a generic light/serif template.

## Definition of done for a change

- Prototype's existing features still work (manual smoke test the export).
- `kdp.js` changes have Node tests.
- No new console errors; fonts loaded before any canvas export.
- `docs/` updated if behavior or geometry changed.
