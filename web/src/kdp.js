// kdp.js — KDP full-wrap cover geometry & constants.
// PURE: no DOM, no canvas, no globals. Unit-tested in test/kdp.test.js.
// All layout is in INCHES; pixels are derived (px = inches * DPI).
// The authority is KDP's own cover calculator — see docs/KDP_SPEC.md.

export const DPI = 300;        // KDP print minimum
export const BLEED = 0.125;    // outer-edge bleed, all four sides of the wrap
export const SAFE = 0.25;      // keep text/important art this far inside the trim

// Per-page visible spine thickness (inches/page) by paper type.
export const PAPER = {
  white: 0.002252,
  cream: 0.0025,
  color: 0.002347, // standard color — verify against KDP before relying on it
};

// Spine text only prints cleanly at/above this page count.
export const SPINE_TEXT_MIN_PAGES = 100;

// KDP ISBN/barcode keep-clear box: 2.0 x 1.2 in, 0.25 in inside the back trim.
export const BARCODE_W = 2.0;
export const BARCODE_H = 1.2;
export const BARCODE_MARGIN = 0.25;

// Full-wrap geometry for a paperback.
// state: { trimW, trimH, pages, paper } — all inches except pages (count).
export function dims({ trimW, trimH, pages, paper }) {
  const spine = pages * paper;                       // visible spine width (in)
  const fullW = BLEED + trimW + spine + trimW + BLEED;
  const fullH = trimH + BLEED * 2;
  return {
    trimW, trimH,
    spine, fullW, fullH,
    pxW: Math.round(fullW * DPI),
    pxH: Math.round(fullH * DPI),
    backX: BLEED,                     // left trim of the back cover
    spineX: BLEED + trimW,            // back|spine fold
    frontX: BLEED + trimW + spine,    // spine|front fold
  };
}

// Safe rectangle (inches) where text/important art must stay.
// side: "back" | "front". width is trimW - 2*SAFE on BOTH sides (invariant #2).
export function safeArea(d, side) {
  const x = (side === "front" ? d.frontX : d.backX) + SAFE;
  return {
    x,
    y: BLEED + SAFE,
    w: d.trimW - 2 * SAFE,
    h: d.fullH - 2 * (BLEED + SAFE),
  };
}

// ISBN/barcode keep-clear box (inches), anchored to the back lower-right trim.
// Back-cover text must flow around this (invariant #4).
export function barcodeBox(d) {
  const right = d.spineX - BARCODE_MARGIN;
  const bottom = d.fullH - BLEED - BARCODE_MARGIN;
  return {
    left: right - BARCODE_W,
    right,
    top: bottom - BARCODE_H,
    bottom,
    w: BARCODE_W,
    h: BARCODE_H,
  };
}

// Spine text is only feasible at/above the page-count floor (invariant #5).
export const spineTextAllowed = (pages) => pages >= SPINE_TEXT_MIN_PAGES;

// Point-based font size -> pixels at a given px-per-inch scale (invariant #1).
// Never multiply by DPI again on top of pxPerInch.
export const fontPx = (sizePt, pxPerInch) => (sizePt / 72) * pxPerInch;

/* ---------- pre-flight: effective DPI of the placed background ---------- */

export const DPI_MIN = 300;    // KDP minimum; below this, warn (soft)
export const DPI_FLOOR = 200;  // below this, hard-warn (will look bad)

// The inches-region the background image is fit into, by fit mode.
export function imageRegion(d, fit) {
  return fit === "front"
    ? { w: d.trimW + BLEED, h: d.fullH }
    : { w: d.fullW, h: d.fullH };
}

// Effective DPI of a cover-fit image placed into a region at a zoom multiplier.
// = native pixels / placed inches. Aspect is preserved, so x == y; return one.
export function effectiveDPI({ imgW, imgH, regionWin, regionHin, zoom }) {
  const z = zoom || 1;
  const ir = imgW / imgH, br = regionWin / regionHin;
  const baseWin = ir > br ? regionHin * ir : regionWin; // cover-fit width (in)
  return imgW / (baseWin * z);
}

export const dpiSeverity = (dpi) =>
  dpi >= DPI_MIN ? "ok" : dpi >= DPI_FLOOR ? "warn" : "bad";

/* ---------- pre-flight: CMYK gamut risk for saturated colors ---------- */
// Print is CMYK; vivid, bright RGB colors (esp. blues/greens) shift on press.
// This is a soft, non-blocking heuristic — KDP's proof is the real check.

export const CMYK_SAT_RISK = 0.7; // HSV saturation at/above which we flag
export const CMYK_VAL_RISK = 0.5; // ...combined with this brightness

export function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHsv(hex) {
  const { r, g, b } = hexToRgb(hex);
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), c = max - min;
  let h = 0;
  if (c !== 0) {
    if (max === R) h = ((G - B) / c) % 6;
    else if (max === G) h = (B - R) / c + 2;
    else h = (R - G) / c + 4;
    h /= 6; if (h < 0) h += 1;
  }
  return { h, s: max === 0 ? 0 : c / max, v: max };
}

// True if a color is vivid/bright enough to shift noticeably in CMYK print.
export function cmykRisk(hex) {
  const { s, v } = rgbToHsv(hex);
  return s >= CMYK_SAT_RISK && v >= CMYK_VAL_RISK;
}

// Snap a value to the nearest target within tolerance (else return it unchanged).
// Used for drag-positioning blocks onto the safe-area guides. Pure.
export function snap(value, targets, tol) {
  for (const t of targets) if (Math.abs(value - t) <= tol) return t;
  return value;
}

/* ---------- gradient geometry (pure) ---------- */
// Endpoints for a linear gradient that spans a w*h box at angleDeg, measured
// from the x-axis: 0 = left->right, 90 = top->bottom. The line is extended so
// the gradient covers the whole box (incl. corners) at any angle.
export function gradientLine(angleDeg, w, h) {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const cx = w / 2, cy = h / 2;
  const half = Math.abs(dx) * w / 2 + Math.abs(dy) * h / 2;
  return { x0: cx - dx * half, y0: cy - dy * half, x1: cx + dx * half, y1: cy + dy * half };
}
