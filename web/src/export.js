// export.js — output deliverables. PNG today (print wrap @300 DPI at exact KDP
// pixel dims, and a 1600x2560 ebook front). A true flattened PDF/X-1a export
// will call the Flask server (server/app.py /api/export-pdf) — M1 in the roadmap.

import { S } from "./state.js";
import { dims, DPI, BLEED } from "./kdp.js";
import { drawCover, drawImageFit, drawWrapText } from "./render.js";

// Print wrap: exact KDP pixel dimensions, no guide overlay.
export function exportWrap() {
  const d = dims(S);
  const c = document.createElement("canvas"); c.width = d.pxW; c.height = d.pxH;
  drawCover(c.getContext("2d"), DPI, false);
  dl(c, `kdp-wrap_${S.trimW}x${S.trimH}_${S.pages}pg_${d.pxW}x${d.pxH}.png`);
}

// Ebook front cover at the common 1600x2560 storefront size.
export function exportEbook() {
  const W = 1600, H = 2560; const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = S.bg; ctx.fillRect(0, 0, W, H);
  if (S.img) {
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, S.imgOpacity));
    const es = W / (S.trimW + BLEED); drawImageFit(ctx, S.img, 0, 0, W, H, S.imgScale, S.imgX * es, S.imgY * es); ctx.restore();
  }
  const box = { x: 0, y: 0, w: W, h: H };
  drawWrapText(ctx, { ...S.title, size: S.title.size * 1.15 }, box, W / (S.trimW + BLEED), "title");
  drawWrapText(ctx, S.author, box, W / (S.trimW + BLEED), "author");
  dl(c, `ebook-front_1600x2560.png`);
}

function dl(canvas, name) {
  canvas.toBlob((b) => {
    const u = URL.createObjectURL(b); const a = document.createElement("a");
    a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000);
  }, "image/png");
}
