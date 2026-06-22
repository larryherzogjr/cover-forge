// render.js — all canvas drawing: full-wrap cover, text/back/spine, image fit,
// guides, the live 2D preview, and the CSS-3D book. Geometry comes from kdp.js;
// this module owns pixels. Font sizing is point-based via kdp.fontPx (invariant
// #1); the image transform is resolution-independent (invariant #3) so the
// preview and the 300-DPI export produce an identical crop.

import { S } from "./state.js";
import { dims, safeArea, barcodeBox, spineTextAllowed, fontPx, gradientLine, hexToRgb, DPI, BLEED, SAFE } from "./kdp.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const withAlpha = (hex, a) => { const { r, g, b } = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

const cv = $("preview");
const cx = cv.getContext("2d");

let PREV_SCALE = 1;                 // px-per-inch of the current preview
export const getPrevScale = () => PREV_SCALE;

// Draggable front blocks. Bounding boxes (preview-scale px) are recorded during
// the live render so ui.js can hit-test pointer events against them.
export const FRONT_BLOCKS = ["title", "author"];
const hitBoxes = {};
export const getHitBox = (kind) => hitBoxes[kind];
export function frontHitTest(px, py) {
  // topmost-first: author sits over title only if overlapping; check both, prefer
  // the smaller/last-drawn. Simple containment is enough for two blocks.
  for (const kind of FRONT_BLOCKS) {
    const b = hitBoxes[kind];
    if (b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return kind;
  }
  return null;
}

// Base fill (solid or linear gradient) for any W*H px region. Shared by the
// wrap render and the ebook export so they stay consistent.
export function fillBackground(ctx, W, H) {
  if (S.bgMode === "gradient") {
    const gl = gradientLine(S.gradient.angle, W, H);
    const grad = ctx.createLinearGradient(gl.x0, gl.y0, gl.x1, gl.y1);
    grad.addColorStop(0, S.gradient.from); grad.addColorStop(1, S.gradient.to);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = S.bg;
  }
  ctx.fillRect(0, 0, W, H);
}

/* ---------- drawing core (resolution-independent via px scale) ---------- */
export function drawCover(ctx, scale, showGuides, recordHits) {
  const d = dims(S);
  const W = d.fullW * scale, H = d.fullH * scale;
  ctx.clearRect(0, 0, W, H);
  if (recordHits) for (const k in hitBoxes) delete hitBoxes[k]; // stale-proof per render

  // base fill — solid or linear gradient
  fillBackground(ctx, W, H);

  // artwork (opacity + blend mode over base, with user pan/zoom)
  if (S.img) {
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, S.imgOpacity));
    ctx.globalCompositeOperation = S.imgBlend || "source-over";
    const px = S.imgX * scale, py = S.imgY * scale;
    if (S.fit === "front") {
      drawImageFit(ctx, S.img, d.frontX * scale, 0, (S.trimW + BLEED) * scale, H, S.imgScale, px, py);
    } else {
      drawImageFit(ctx, S.img, 0, 0, W, H, S.imgScale, px, py);
    }
    ctx.restore();
  }

  const front = { x: d.frontX * scale, y: 0, w: S.trimW * scale, h: H };

  // ---- BACK COVER VERBIAGE (flows around barcode zone) ----
  drawBackText(ctx, scale);
  // ---- TITLE (front cover) ----
  drawWrapText(ctx, S.title, front, scale, "title", recordHits);
  // ---- AUTHOR ----
  drawWrapText(ctx, S.author, front, scale, "author", recordHits);

  // ---- SPINE TEXT ----
  if (S.spine.text && spineTextAllowed(S.pages)) {
    ctx.save();
    const sx = (d.spineX + d.spine / 2) * scale, sy = H / 2;
    ctx.translate(sx, sy); ctx.rotate(S.spine.flip ? Math.PI / 2 : -Math.PI / 2);
    ctx.fillStyle = S.spine.color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "600 " + (d.spine * scale * 0.5) + "px 'Cormorant Garamond',serif";
    ctx.fillText(S.spine.text, 0, 0, H * 0.82);
    ctx.restore();
  }

  if (showGuides) drawGuides(ctx, d, scale, W, H);
}

export function drawWrapText(ctx, o, box, scale, kind, recordHits) {
  if (!o.text.trim()) return;
  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const px = Math.max(6, fontPx(o.size, scale));   // size slider is in points
  ctx.font = (kind === "title" ? "700 " : "600 ") + px + "px '" + o.font + "'";
  if (o.letterSpacing) ctx.letterSpacing = fontPx(o.letterSpacing, scale) + "px"; // pt -> px
  const text = o.caps ? o.text.toUpperCase() : o.text;
  const cx2 = box.x + box.w * (o.x != null ? o.x : 0.5);  // horizontal center
  const cy = box.h * (o.y / 100);
  const lines = wrapLines(ctx, text, box.w * 0.84);
  const lh = px * (o.lineHeight || 1.12);
  const strokePx = o.stroke && o.stroke.width ? fontPx(o.stroke.width, scale) : 0;
  if (recordHits) {
    const maxW = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
    hitBoxes[kind] = { x: cx2 - maxW / 2, y: cy - lines.length * lh / 2, w: maxW, h: lines.length * lh };
  }
  let y = cy - (lines.length - 1) * lh / 2;
  for (const ln of lines) {
    if (o.shadow) {
      ctx.save();
      ctx.shadowColor = withAlpha(o.shadowColor || "#000000", o.shadowOpacity != null ? o.shadowOpacity : 0.45);
      ctx.shadowBlur = fontPx(o.shadowBlur || 0, scale);
      ctx.shadowOffsetX = fontPx(o.shadowDX || 0, scale);
      ctx.shadowOffsetY = fontPx(o.shadowDY || 0, scale);
      ctx.fillStyle = o.color; ctx.fillText(ln, cx2, y);
      ctx.restore();
    }
    if (strokePx > 0) {
      ctx.lineWidth = strokePx; ctx.strokeStyle = o.stroke.color; ctx.lineJoin = "round";
      ctx.strokeText(ln, cx2, y);
    }
    ctx.fillStyle = o.color; ctx.fillText(ln, cx2, y);
    y += lh;
  }
  ctx.restore();
}

/* back cover blurb: wraps top-down in the safe area and flows AROUND
   the KDP ISBN/barcode keep-clear box in the lower-right of the back */
function drawBackText(ctx, scale) {
  const o = S.back; if (!o.text.trim()) return;
  const d = dims(S);
  const sa = safeArea(d, "back");
  const left = sa.x * scale;
  const right = (sa.x + sa.w) * scale;
  const top = sa.y * scale;
  const bottom = (sa.y + sa.h) * scale;
  const startY = top + (o.y / 100) * (d.fullH * scale);

  const g = 0.12 * scale;                       // gutter around the barcode
  const bc = barcodeBox(d);
  const avoidX0 = bc.left * scale - g;
  const avoidY0 = bc.top * scale - g;
  const avoidY1 = bc.bottom * scale;

  const px = Math.max(6, fontPx(o.size, scale)); // points
  const lh = px * (o.lineHeight || 1.34);
  ctx.save();
  ctx.fillStyle = o.color; ctx.textBaseline = "top";
  ctx.font = px + "px '" + o.font + "'";

  let y = startY;
  const paras = o.text.split(/\n/);
  for (let p = 0; p < paras.length; p++) {
    const para = paras[p].trim();
    if (para === "") { y += lh * 0.55; continue; }
    const words = para.split(/\s+/);
    let i = 0;
    while (i < words.length) {
      if (y + lh > bottom) break;                          // clamp inside safe bottom
      const overlaps = (y + lh > avoidY0 && y < avoidY1);  // line band hits barcode rows
      const rb = overlaps ? Math.min(right, avoidX0) : right; // narrow right edge if so
      const availW = rb - left;
      let line = "", j = i;
      while (j < words.length) {
        const test = line ? line + " " + words[j] : words[j];
        if (ctx.measureText(test).width > availW && line) break;
        line = test; j++;
      }
      if (line === "") { line = words[i]; j = i + 1; }
      if (o.align === "center") { ctx.textAlign = "center"; ctx.fillText(line, left + availW / 2, y); }
      else { ctx.textAlign = "left"; ctx.fillText(line, left, y); }
      i = j; y += lh;
    }
    y += lh * 0.4;
    if (y + lh > bottom) break;
  }
  ctx.restore();
}

function wrapLines(ctx, text, maxW) {
  const words = text.split(/\s+/); const out = []; let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t;
  }
  if (cur) out.push(cur); return out;
}

export function drawImageFit(ctx, img, rx, ry, rw, rh, zoom, panXpx, panYpx) {
  zoom = zoom || 1; panXpx = panXpx || 0; panYpx = panYpx || 0;
  const ir = img.width / img.height, br = rw / rh; let bw, bh;  // base = cover-fit of region
  if (ir > br) { bh = rh; bw = rh * ir; } else { bw = rw; bh = rw / ir; }
  const dw = bw * zoom, dh = bh * zoom;
  const dx = rx + (rw - dw) / 2 + panXpx, dy = ry + (rh - dh) / 2 + panYpx;
  ctx.save(); ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip(); ctx.drawImage(img, dx, dy, dw, dh); ctx.restore();
}

function drawGuides(ctx, d, scale, W, H) {
  const I = (v) => v * scale;
  // bleed (outer) — red dashed
  line(ctx, I(BLEED), 0, I(BLEED), H, "#ff5a5a", 1, [6, 5]);
  line(ctx, W - I(BLEED), 0, W - I(BLEED), H, "#ff5a5a", 1, [6, 5]);
  line(ctx, 0, I(BLEED), W, I(BLEED), "#ff5a5a", 1, [6, 5]);
  line(ctx, 0, H - I(BLEED), W, H - I(BLEED), "#ff5a5a", 1, [6, 5]);
  // spine fold lines — cyan
  line(ctx, I(d.spineX), 0, I(d.spineX), H, "#39d4ff", 1.3, []);
  line(ctx, I(d.frontX), 0, I(d.frontX), H, "#39d4ff", 1.3, []);
  // safe margin — green dashed: 0.25" inside the trim on all four sides
  const back = safeArea(d, "back"), frontSafe = safeArea(d, "front");
  rectStroke(ctx, back.x * scale, back.y * scale, back.w * scale, back.h * scale, "#54e08a", [5, 5]);
  rectStroke(ctx, frontSafe.x * scale, frontSafe.y * scale, frontSafe.w * scale, frontSafe.h * scale, "#54e08a", [5, 5]);
  // barcode zone (back, lower-right)
  const bc = barcodeBox(d);
  const bx = bc.left * scale, by = bc.top * scale, bw = bc.w * scale, bh = bc.h * scale;
  rectStroke(ctx, bx, by, bw, bh, "#ffd166", [4, 4]);
  ctx.fillStyle = "rgba(255,209,102,.10)"; ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = "#ffd166"; ctx.font = "10px 'Space Mono'"; ctx.textAlign = "left";
  ctx.fillText("ISBN / barcode", bx + 6, by + 15); ctx.fillText("keep clear", bx + 6, by + 28);
  // labels
  ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.font = "11px 'Space Mono'"; ctx.textAlign = "center";
  ctx.fillText("BACK", I(BLEED) + I(S.trimW) / 2, 22);
  ctx.fillText("SPINE", I(d.spineX) + I(d.spine) / 2, H - 14);
  ctx.fillText("FRONT", I(d.frontX) + I(S.trimW) / 2, 22);
}

function line(ctx, x1, y1, x2, y2, c, w, dash) {
  ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = w; ctx.setLineDash(dash || []);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
}
function rectStroke(ctx, x, y, w, h, c, dash) {
  ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.setLineDash(dash || []);
  ctx.strokeRect(x, y, w, h); ctx.restore();
}

/* ---------- live preview ---------- */
export function render() {
  const d = dims(S);
  const stageW = Math.min($("view2d").parentElement.clientWidth - 40, 760);
  let scale = stageW / d.fullW;                       // px per inch (fit)
  if (S.zoom > 0) scale = scale * (1 + S.zoom * 0.35);
  PREV_SCALE = scale;
  const W = Math.round(d.fullW * scale), H = Math.round(d.fullH * scale);
  cv.width = W; cv.height = H;
  drawCover(cx, scale, S.guides, true);
  drawSelection();
  if (S.view === "3d") build3D();
}

// Dashed brass outline around the selected draggable block (preview only).
function drawSelection() {
  const b = S.selected && hitBoxes[S.selected];
  if (!b) return;
  const pad = 6;
  cx.save();
  cx.strokeStyle = "#e3c982"; cx.lineWidth = 1.5; cx.setLineDash([6, 4]);
  cx.strokeRect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad);
  cx.restore();
}

/* ---------- 3D ---------- */
function faceCanvas(part) {
  const d = dims(S); const sc = 300 / d.fullH; // px per inch for 3D textures
  const c = document.createElement("canvas");
  let region;
  if (part === "front") region = [d.frontX, 0, S.trimW + BLEED, d.fullH];
  else if (part === "back") region = [0, 0, S.trimW + BLEED, d.fullH];
  else region = [d.spineX, 0, d.spine, d.fullH];
  c.width = Math.max(2, Math.round(region[2] * sc)); c.height = Math.round(region[3] * sc);
  const fctx = c.getContext("2d");
  // draw full cover into temp then copy region
  const tmp = document.createElement("canvas");
  tmp.width = Math.round(d.fullW * sc); tmp.height = Math.round(d.fullH * sc);
  drawCover(tmp.getContext("2d"), sc, false);
  fctx.drawImage(tmp, region[0] * sc, region[1] * sc, region[2] * sc, region[3] * sc, 0, 0, c.width, c.height);
  return c.toDataURL();
}

let rotY = -28, rotX = -8;
function build3D() {
  const d = dims(S);
  const book = $("book");
  const faceH = 300;
  const faceW = (S.trimW) / (S.trimH + BLEED * 2) * faceH;
  const spineW = Math.max(6, (d.spine) / (S.trimH + BLEED * 2) * faceH);
  book.style.width = faceW + "px"; book.style.height = faceH + "px";
  book.innerHTML = "";
  const mk = (cls, img, w, tf, extra) => {
    const f = document.createElement("div"); f.className = "face " + cls;
    f.style.width = w + "px"; f.style.height = faceH + "px"; f.style.transform = tf;
    if (img) { const im = document.createElement("img"); im.src = img; f.appendChild(im); }
    if (extra) f.style.cssText += extra;
    book.appendChild(f); return f;
  };
  mk("front", faceCanvas("front"), faceW, `translateZ(${spineW / 2}px)`);
  mk("back", faceCanvas("back"), faceW, `rotateY(180deg) translateZ(${spineW / 2}px)`);
  mk("spine", faceCanvas("spine"), spineW, `rotateY(-90deg) translateZ(${spineW / 2}px)`, "left:0;");
  // pages (right edge)
  const pg = document.createElement("div"); pg.className = "pages";
  pg.style.cssText += `width:${spineW}px;right:0;transform:rotateY(90deg) translateZ(${faceW - spineW / 2}px);`;
  book.appendChild(pg);
  applyRot();
}
export function applyRot() {
  const b = $("book");
  if (b) b.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
}
// Drag-to-rotate, driven by ui.js pointer handlers.
export function rotateBy(dxPx, dyPx) {
  rotY += dxPx * 0.5;
  rotX = clamp(rotX - dyPx * 0.3, -40, 40);
  applyRot();
}
