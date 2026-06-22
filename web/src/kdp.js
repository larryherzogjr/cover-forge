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
