// Node tests for the pure geometry in src/kdp.js.
// Cases mirror the worked examples and invariants in docs/KDP_SPEC.md.
// Run: cd web && node --test   (or npm test)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DPI, BLEED, SAFE, PAPER, SPINE_TEXT_MIN_PAGES,
  BARCODE_W, BARCODE_H, BARCODE_MARGIN,
  DPI_MIN, DPI_FLOOR,
  dims, safeArea, barcodeBox, spineTextAllowed, fontPx,
  imageRegion, effectiveDPI, dpiSeverity,
  hexToRgb, rgbToHsv, cmykRisk,
} from "../src/kdp.js";

const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);

test("constants match the spec", () => {
  assert.equal(DPI, 300);
  assert.equal(BLEED, 0.125);
  assert.equal(SAFE, 0.25);
  assert.equal(PAPER.white, 0.002252);
  assert.equal(PAPER.cream, 0.0025);
  assert.equal(PAPER.color, 0.002347);
  assert.equal(SPINE_TEXT_MIN_PAGES, 100);
  assert.deepEqual([BARCODE_W, BARCODE_H, BARCODE_MARGIN], [2.0, 1.2, 0.25]);
});

test("worked example: 6x9, 220pg, white", () => {
  const d = dims({ trimW: 6, trimH: 9, pages: 220, paper: PAPER.white });
  near(d.spine, 0.49544);
  near(d.fullW, 12.74544);   // 2*6 + spine + 0.25
  near(d.fullH, 9.25);       // 9 + 0.25
  assert.equal(d.pxW, 3824);
  assert.equal(d.pxH, 2775);
});

test("reference example: 6x9, 250pg, cream", () => {
  const d = dims({ trimW: 6, trimH: 9, pages: 250, paper: PAPER.cream });
  near(d.spine, 0.625);
  near(d.fullW, 12.875);
  near(d.fullH, 9.25);
  assert.equal(d.pxW, 3863);   // round(12.875 * 300)
  assert.equal(d.pxH, 2775);
});

test("fold x-positions are left-to-right and consistent", () => {
  const d = dims({ trimW: 6, trimH: 9, pages: 220, paper: PAPER.white });
  near(d.backX, BLEED);
  near(d.spineX, BLEED + 6);            // back|spine fold
  near(d.frontX, BLEED + 6 + d.spine);  // spine|front fold
  // frontRightTrim == fullWidth - bleed
  near(d.frontX + 6, d.fullW - BLEED);
});

test("safe rectangle is inset 0.25in on ALL four sides (invariant #2)", () => {
  const d = dims({ trimW: 6, trimH: 9, pages: 220, paper: PAPER.white });
  const back = safeArea(d, "back");
  near(back.w, 6 - 2 * SAFE);                 // width = trimW - 2*SAFE, NOT trimW - SAFE
  near(back.h, 9 - 2 * SAFE);                 // height = trimH - 2*SAFE
  near(back.x, BLEED + SAFE);
  near(back.y, BLEED + SAFE);
  // back safe right edge sits one SAFE inside the spine fold
  near(back.x + back.w, d.spineX - SAFE);

  const front = safeArea(d, "front");
  near(front.w, 6 - 2 * SAFE);
  near(front.x, d.frontX + SAFE);
  near(front.y, back.y);                      // same vertical band as back
});

test("barcode keep-clear box: 2x1.2in, 0.25in inside the back trim", () => {
  const d = dims({ trimW: 6, trimH: 9, pages: 220, paper: PAPER.white });
  const bc = barcodeBox(d);
  near(bc.w, BARCODE_W);
  near(bc.h, BARCODE_H);
  near(bc.right, d.spineX - BARCODE_MARGIN);          // 0.25 left of back|spine fold
  near(bc.bottom, d.fullH - BLEED - BARCODE_MARGIN);  // 0.25 above the trim
  near(bc.left, bc.right - BARCODE_W);
  near(bc.top, bc.bottom - BARCODE_H);
});

test("spine text only allowed at/above the page floor (invariant #5)", () => {
  assert.equal(spineTextAllowed(220), true);
  assert.equal(spineTextAllowed(100), true);
  assert.equal(spineTextAllowed(99), false);
  assert.equal(spineTextAllowed(24), false);
});

test("font sizing is point-based, no double DPI (invariant #1)", () => {
  // 72pt at 300 px/in is exactly 300px; never *DPI again on top of the scale.
  near(fontPx(72, 300), 300);
  near(fontPx(12, 300), 50);
  near(fontPx(74, 57), 74 / 72 * 57); // ~preview px/in
});

test("exported pixel dims == round(full * DPI)", () => {
  const d = dims({ trimW: 8.5, trimH: 11, pages: 300, paper: PAPER.color });
  assert.equal(d.pxW, Math.round(d.fullW * DPI));
  assert.equal(d.pxH, Math.round(d.fullH * DPI));
});

test("imageRegion: wrap covers the full wrap; front covers trim+bleed", () => {
  const d = dims({ trimW: 6, trimH: 9, pages: 220, paper: PAPER.white });
  const wrap = imageRegion(d, "wrap");
  near(wrap.w, d.fullW); near(wrap.h, d.fullH);
  const front = imageRegion(d, "front");
  near(front.w, 6 + BLEED); near(front.h, d.fullH);
});

test("effectiveDPI: native px over placed inches, aspect-preserved", () => {
  // Image exactly the wrap's aspect, placed at zoom 1: dpi = imgW / fullW.
  const d = dims({ trimW: 6, trimH: 9, pages: 220, paper: PAPER.white });
  const r = imageRegion(d, "wrap");
  // a tall-ish image that's wider than the region -> fit by height
  const dpi = effectiveDPI({ imgW: 3000, imgH: 2000, regionWin: r.w, regionHin: r.h, zoom: 1 });
  // region ratio 12.745/9.25 = 1.378; img ratio 1.5 > br -> baseW = regionH*ir
  const baseWin = r.h * (3000 / 2000);
  near(dpi, 3000 / baseWin);
  // zooming in halves effective DPI of the doubled placement
  const dpi2 = effectiveDPI({ imgW: 3000, imgH: 2000, regionWin: r.w, regionHin: r.h, zoom: 2 });
  near(dpi2, dpi / 2);
});

test("dpiSeverity thresholds", () => {
  assert.equal(dpiSeverity(DPI_MIN), "ok");
  assert.equal(dpiSeverity(350), "ok");
  assert.equal(dpiSeverity(250), "warn");
  assert.equal(dpiSeverity(DPI_FLOOR), "warn");
  assert.equal(dpiSeverity(150), "bad");
});

test("hexToRgb handles #rrggbb and #rgb", () => {
  assert.deepEqual(hexToRgb("#ff8800"), { r: 255, g: 136, b: 0 });
  assert.deepEqual(hexToRgb("#f80"), { r: 255, g: 136, b: 0 });
  assert.deepEqual(hexToRgb("000000"), { r: 0, g: 0, b: 0 });
});

test("rgbToHsv basics", () => {
  const red = rgbToHsv("#ff0000");
  near(red.s, 1); near(red.v, 1);
  const white = rgbToHsv("#ffffff");
  near(white.s, 0); near(white.v, 1);
});

test("cmykRisk flags vivid colors, spares brand navy/gold/paper", () => {
  assert.equal(cmykRisk("#ff0000"), true);   // pure red
  assert.equal(cmykRisk("#0000ff"), true);   // pure blue
  assert.equal(cmykRisk("#00ff66"), true);   // vivid green
  assert.equal(cmykRisk("#0e1a2b"), false);  // brand navy (too dark)
  assert.equal(cmykRisk("#c6a75e"), false);  // brass/gold (moderate sat)
  assert.equal(cmykRisk("#f4efe3"), false);  // paper (low sat)
});
