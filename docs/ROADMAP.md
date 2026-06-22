# Roadmap / Backlog

Tasks are grouped into milestones and ordered by value. Checkboxes are GitHub-
issue-ready. The seed snippet at the bottom turns these into issues with `gh`.

## M0 — Repo & refactor (done)

- [x] `git init`; commit `web/index.html` prototype as the known-good baseline; push to GitHub.
- [x] Add `LICENSE` (owner's choice — MIT is a reasonable default for a personal tool).
- [x] Split `index.html` into `src/{kdp,state,render,export,ui,fonts}.js` per `CLAUDE.md`. Behavior unchanged.
- [x] Keep `kdp.js` DOM-free (pure geometry). Add Node tests covering the worked examples in `docs/KDP_SPEC.md` (`web/test/kdp.test.js`).
- [x] Add a pre-commit JS syntax check + tests (`.githooks/pre-commit`; enable with `git config core.hooksPath .githooks`).

## M1 — Output correctness (Tier 1) — done

- [x] **Effective-DPI check** on the placed background: compute `nativePx ÷ placedInches`; warn (non-blocking) below 300, hard-warn below 200. Client-side.
- [x] **CMYK shift warning**: flag highly saturated fills/text colors that will shift on press; one-line non-blocking notice. Client-side.
- [x] **PDF export** via the API: client posts the 300-DPI render + trim/bleed dims; server returns a flattened print PDF (MediaBox = full wrap, TrimBox inset by bleed). See `server/app.py` `/api/export-pdf`.
- [x] **CMYK PDF** option: `cmyk:true` converts RGB→CMYK via `ImageCms` + `CF_CMYK_ICC` (or naive fallback, flagged in `X-CMYK-Mode`). PDF/X-1a via Ghostscript documented as the optional strict path (`docs/DEPLOYMENT.md`).

## M2 — Design parity (Tier 2, all client-side)

- [ ] Free **drag-positioning** for any text block on front/back (snap to safe-area guides).
- [ ] Additional text blocks: subtitle, series name, front pull-quote/endorsement, back tagline, author bio.
- [x] Text controls: stroke/outline, letter-spacing, line-height, all-caps toggle, shadow tuning (offset/blur/opacity). Title gets the full set; author gets caps/letter-spacing/outline; back gets line-height.
- [x] **Solid + gradient** background mode (no image required). Two-stop linear gradient at an adjustable angle (`kdp.gradientLine`).
- [x] Image **blend modes** (normal/multiply/screen/overlay/darken/lighten) via `globalCompositeOperation`. (RGB color grading still TODO.)
- [ ] **Overlay/logo layers**: place additional PNGs (e.g. a publisher mark or a background-removed subject) with their own move/scale.

## M3 — Workflow & server features (Tier 3)

- [ ] **Project save/load** as portable JSON (serialize `S`, including image as data URL or a referenced asset). Export/import buttons. (Browser storage is fine when self-hosted; the JSON file is the portable path.)
- [ ] **Background removal**: `/api/remove-bg` with rembg/BiRefNet on the local GPU box; wire a "Remove background" action on the uploaded image; result becomes an overlay layer.
- [ ] **Hardcover mode**: implement case-laminate spine/hinge/wrap math from `docs/KDP_SPEC.md` — verify every number against KDP's calculator first; add a binding toggle.
- [ ] **Font-load hardening**: `await document.fonts.load(...)` for all selected faces before any export.
- [ ] **Undo/redo** (command stack over `S`).

## M4 — Nice-to-have

- [ ] IngramSpark mode (different per-page thickness; documented in code comments).
- [ ] Per-trim barcode-position nuance if Amazon's placement varies by size.
- [ ] Keyboard nudging for selected elements; alignment helpers.
- [ ] Optional own-barcode placement (for authors bringing their own ISBN).

## Out of scope (unless the goal changes)

Stock-image library (licensing cost, owner supplies art), user accounts, billing,
multi-tenant hosting.

## Seed GitHub issues

```bash
# after gh auth login and gh repo create
while IFS= read -r line; do
  [ -z "$line" ] && continue
  gh issue create --title "$line" --body "See docs/ROADMAP.md"
done <<'ISSUES'
Refactor prototype into src/ modules
Add kdp.js Node tests from KDP_SPEC examples
Effective-DPI warning on placed background
CMYK shift warning for saturated colors
PDF export endpoint and client wiring
Project save/load as JSON
Background removal endpoint + overlay wiring
Hardcover/case-laminate mode (verify math first)
Free drag-positioning for text blocks
Solid + gradient background mode
ISSUES
```
