# KDP Cover Geometry — Spec & Constants

The authoritative source is always **Amazon KDP's own cover calculator** plus a
**printed proof copy**. The values below match third-party KDP calculators as of
mid-2026 and the prototype implements them, but Amazon can change them and is the
final word. Treat this file as the single place geometry constants live; do not
scatter magic numbers through the code.

## Units

All layout is in **inches**. Pixels are derived: `px = inches * DPI`, with
`DPI = 300` for export and a smaller px-per-inch scale for preview. Never store
layout in pixels.

## Constants

| Name | Value | Notes |
|------|-------|-------|
| `DPI` | 300 | KDP minimum for print. |
| `BLEED` | 0.125 in | All four outer edges of the wrap. |
| `SAFE` | 0.25 in | Keep text/important art this far inside the trim. |
| Paper: white | 0.002252 in/page | Spine multiplier. |
| Paper: cream | 0.0025 in/page | Spine multiplier. |
| Paper: color (standard) | 0.002347 in/page | **Verify** — sources vary (some cite ~0.0032 for standard color). Confirm against KDP's calculator before relying on it. |
| Spine-text minimum | ~100 pages | Sources cite 79–100; KDP currently treats ~100 as the practical floor. Keep text off the spine below this. |
| Barcode keep-clear box | 2.0 × 1.2 in | Lower-right of the **back** cover, 0.25 in in from the trim edges. KDP places its own barcode here. |

## Paperback full-wrap formulas

```
spine      = pageCount * paperThickness        # inches
fullWidth  = BLEED + trimW + spine + trimW + BLEED   # = 2*trimW + spine + 0.25
fullHeight = trimH + 2*BLEED                          # = trimH + 0.25

# x positions across the wrap (left to right), in inches:
backLeftTrim   = BLEED
spineLeftFold  = BLEED + trimW                  # back|spine fold
frontLeftFold  = BLEED + trimW + spine          # spine|front fold
frontRightTrim = BLEED + trimW + spine + trimW  # = fullWidth - BLEED

pxWidth  = round(fullWidth  * DPI)
pxHeight = round(fullHeight * DPI)
```

### Safe areas (text/important art must stay inside)

```
# Back cover safe rectangle (inches):
x: [BLEED+SAFE, spineLeftFold-SAFE]   width  = trimW - 2*SAFE
y: [BLEED+SAFE, fullHeight-BLEED-SAFE] height = trimH - 2*SAFE

# Front cover safe rectangle:
x: [frontLeftFold+SAFE, frontRightTrim-SAFE]  width = trimW - 2*SAFE
y: same as back
```

### Barcode keep-clear box (inches)

```
bcRight  = spineLeftFold - 0.25     # 0.25 in left of the back|spine fold
bcLeft   = bcRight - 2.0
bcBottom = (fullHeight - BLEED) - 0.25
bcTop    = bcBottom - 1.2
```
Back-cover text must flow around this box (treat it as a right-side float in the
back safe column). Add a small gutter (~0.12 in) so text doesn't kiss it.

## Worked example (sanity check for tests)

6 × 9 in, 220 pages, white paper:

```
spine      = 220 * 0.002252 = 0.49544 in
fullWidth  = 2*6 + 0.49544 + 0.25 = 12.74544 in   -> 3824 px @300
fullHeight = 9 + 0.25 = 9.25 in                    -> 2775 px @300
```

Cream-paper reference often cited: 6 × 9, 250 pages, cream → spine 0.625 in,
full wrap 12.875 × 9.25 in (3863 × 2775 px @300).

## The +0.06″ binding-allowance caveat

Third-party calculators disagree on whether a ~0.06 in cover-stock/binding
allowance is folded into the *visible* spine width. KDP's official calculator is
authoritative; the worked examples above (which match KDP template downloads) do
**not** add it to the visible spine. Always reconcile against KDP's calculator
and a proof before a print run. The prototype uses `spine = pages * thickness`.

## Hardcover / case-laminate (implemented; numbers confirmed against KDP)

Confirmed from KDP's "Create a Hardcover Cover" guide (help topic
GDTKFJPNQCBTMRV6) and Print Options (G201834180), checked 2026-06-22. These are
the values `kdp.js` uses (`HC_*` constants):

| Name | Value | Notes |
|------|-------|-------|
| `HC_WRAP` | 0.51 in | File extends this far past each cover edge (turn-in over the boards). The hardcover analogue of bleed. |
| `HC_SAFE` | 0.635 in | Keep text/art this far inside the cover edge. |
| `HC_HINGE` | 0.4 in | Keep-clear between the spine and the safe area on front & back (the case bends here). |
| Barcode | 2.0 × 1.2 in | ≥ 0.76 in from the bottom, ≥ 0.25 in from the spine hinge. |
| Pages | 75–550 | All hardcover trim sizes. |
| Trims | 5.5×8.5, 6×9, 6.14×9.21, 7×10, 8.25×11 | |
| Paper | cream / white / premium color | No groundwood or standard-color for hardcover. |

```
fullWidth  = HC_WRAP + trimW + spine + trimW + HC_WRAP
fullHeight = trimH + 2*HC_WRAP
# safe area: outer edges inset HC_SAFE; spine-fold side inset HC_HINGE
```

**Spine width is the one unknown.** KDP does not publish per-page thickness
anywhere static (true for paperback too — our paperback numbers come from KDP
template downloads). The hardcover case spine is wider than the text block
because of the boards, and only KDP's cover calculator gives the exact value.
The app therefore estimates the spine (page-block `pages × thickness`) and lets
the user paste KDP's exact spine into a "Spine width (from KDP calculator)"
field, with a prominent warning to confirm + order a proof before printing.

## Pre-upload checklist (encode as validations)

- Placed background's effective DPI >= 300 (native px ÷ placed inches).
- All text inside the safe rectangles.
- No draggable text or overlay layers in the barcode keep-clear box (the back
  blurb flows around it automatically).
- Spine text only if pages >= ~100.
- Exported pixel dims == `round(fullWidth*300) × round(fullHeight*300)`.
- Remember RGB→CMYK shift on press (esp. saturated navy/gold).
