# Cover Forge — Handoff

> **Status (updated):** the original prototype has since been built out — M0–M4
> are implemented (module refactor, DPI/CMYK pre-flight, PDF/CMYK export,
> gradient/blend backgrounds, full text controls, drag-positioning + keyboard
> nudging, front/back text blocks, overlay layers, project save/load + autosave,
> background removal, hardcover mode, undo/redo). See `docs/ROADMAP.md` for the
> per-item status. The sections below are the original handoff, kept for context.

This document hands a working prototype off to a fresh Claude Code instance for
local development, GitHub sync, and server deployment. It explains what exists,
why decisions were made, what's done, and what's left. For the loaded-every-
session short version see `CLAUDE.md`. For the print math see `docs/KDP_SPEC.md`.
For the task list see `docs/ROADMAP.md`. For server setup see `docs/DEPLOYMENT.md`.

## 1. Purpose

A self-hosted generator for Amazon KDP **full-wrap** paperback covers (back +
spine + front in one print file), built so the owner can stop paying a per-cover
SaaS (Coverjig-class tool). It must produce print-ready output at the exact KDP
dimensions, automate the spine/bleed/safe-margin math that causes most cover
rejections, and keep the ISBN/barcode area clear.

It is **not** trying to become a commercial multi-tenant service. No accounts,
no billing, no stock-photo library (the owner supplies/generates art). Those are
explicitly out of scope unless the goal changes.

## 2. Current state (the prototype)

`web/index.html` is a single self-contained file (no dependencies, runs from
`file://` or any static server). It is fully working and is the reference for
behavior. Implemented:

- Trim size (common KDP presets + custom W/H), page count, paper type.
- Auto spine width, full-wrap dimensions, pixel dims @300 DPI, live readouts.
- Spine-text feasibility check (>= 100 pages) with warning.
- 2D full-wrap canvas preview with toggleable guides: bleed, spine folds, safe
  margins (0.25″ all sides), and the ISBN/barcode keep-clear box.
- 3D book preview (CSS 3D, drag to rotate) built from the three rendered faces.
- Background image: upload (file picker + drag/drop), **opacity**, **base color**
  behind the image, and **pan/zoom** — drag the preview to move, scroll to zoom
  anchored at the cursor, plus a size slider and reset.
- Dominant-color palette extraction from the uploaded image (click a swatch to
  set title color).
- Genre presets that suggest fonts + colors.
- Front **title** and **author**: font, point size, vertical position, color,
  optional shadow; text auto-wraps and centers on the front trim.
- **Spine** text: color + 180° orientation flip; hidden under 100 pages.
- **Back-cover blurb**: font, size, top position, alignment, color; multi-
  paragraph; **flows around the ISBN/barcode box** like a floated element.
- Export: print wrap **PNG @300 DPI** at exact pixel dims; ebook front PNG
  (1600×2560).

### Bugs already found and fixed (don't reintroduce — see CLAUDE.md invariants)

- Font sizing double-counted DPI → titles rendered ~1200px tall. Now point-based
  (`pt/72 * pxPerInch`).
- Safe-margin guides subtracted the margin from only one side → boxes touched the
  spine fold / cover edge. Now inset 0.25″ on all four sides.
- Image crop now stored in inches/zoom-multiplier so preview == 300-DPI export.

## 3. Why these choices

- **Vanilla + Canvas, no framework.** The whole app is geometry → pixels. Canvas
  is the natural fit, the output must be exact, and a framework adds weight
  without buying anything here. Keep it that way.
- **Points for type.** Print designers think in points; point-based sizing is the
  only thing that stays consistent between a ~57px/in preview and a 300px/in
  export.
- **Inches as the source of truth.** Every layout value is inches; pixels are
  derived by multiplying by a px-per-inch scale (preview scale or 300). This is
  what makes WYSIWYG export trustworthy.
- **Single file first.** Fastest path to a working tool. Now that it works, the
  first Claude Code task is a clean module split (`CLAUDE.md` shows the target).

## 4. What's left (summary; full list in docs/ROADMAP.md)

**Tier 1 — output correctness (highest value).**
- Real PDF export (flattened, ideally PDF/X-1a, CMYK), the proper print
  deliverable. PNG works but is RGB and less robust. Needs the server.
- Effective-DPI check on the placed background (native px ÷ placed inches); warn
  below 300. Pure client-side, cheap, do first.
- CMYK color awareness: warn that saturated colors (the navy, the brass-gold)
  shift on press; ideally a soft-proof. Warning is client-side; true proof is
  server.

**Tier 2 — design parity (all client-side).**
- Free drag-positioning for text; more blocks (subtitle, series, front pull-
  quote, back tagline + bio, logo).
- Text controls: stroke/outline, letter-spacing, line-height, all-caps, shadow
  tuning.
- Solid + gradient backgrounds (typographic covers without an image).
- Image blend modes + basic color grading; overlay/logo layers.

**Tier 3 — workflow + the two server features.**
- Save/load projects as a portable JSON file (every reload currently loses work).
- Background removal (server; runs well on the owner's local GPU box).
- Hardcover / case-laminate mode (different spine + hinge + wrap math — verify
  against KDP's calculator before shipping).
- Font-load-before-export hardening; undo/redo.

## 5. Proposed architecture

```
Browser (static, nginx)                 Flask API (systemd, port 5004)
  index.html + src/*.js        ──>        POST /api/remove-bg   (rembg/BiRefNet)
  Canvas render + PNG export   ──>        POST /api/export-pdf  (Pillow/Ghostscript)
  Project JSON save/load
```

The frontend stays fully usable offline for everything except background removal
and PDF export, which call the API. Keep that boundary clean so the tool degrades
gracefully if the API is down.

## 6. Suggested first session for Claude Code

1. `git init`, commit the prototype as-is (`web/index.html`) so there's a known-
   good baseline. Push to GitHub.
2. Refactor `index.html` into the `src/` module layout from `CLAUDE.md`, behavior
   unchanged. Add a tiny Node test file for `kdp.js` covering the spec examples
   in `docs/KDP_SPEC.md`.
3. Tier-1 client-side items: DPI warning + CMYK warning + project save/load.
4. Stand up `server/app.py` (scaffold included) with the two endpoints; wire the
   frontend "Remove background" and "Download print PDF" buttons.
5. Deploy per `docs/DEPLOYMENT.md`.

Commit in small, reviewable steps. Update the docs as you go.
