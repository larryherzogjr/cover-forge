// export.js — output deliverables. PNG today (print wrap @300 DPI at exact KDP
// pixel dims, and a 1600x2560 ebook front). A true flattened PDF/X-1a export
// will call the Flask server (server/app.py /api/export-pdf) — M1 in the roadmap.

import { S } from "./state.js";
import { dims, DPI, BLEED } from "./kdp.js";
import { drawCover, drawImageFit, drawWrapText, fillBackground } from "./render.js";

// API origin for the server-only features (PDF, bg-removal). In dev the static
// site is on :8080 and Flask on :5004; in prod nginx proxies same-origin /api.
// Override with window.CF_API_BASE if your setup differs.
const API_BASE = (typeof window !== "undefined" && window.CF_API_BASE) ||
  (typeof location !== "undefined" && location.port === "8080" ? "http://127.0.0.1:5004" : "");

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
  fillBackground(ctx, W, H);
  if (S.img) {
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, S.imgOpacity));
    ctx.globalCompositeOperation = S.imgBlend || "source-over";
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

function dlBlob(blob, name) {
  const u = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000);
}

// Print-grade PDF via the server: render the 300-DPI wrap, post it, download the
// returned flattened PDF (MediaBox = full wrap, TrimBox inset by bleed). Throws
// on failure so the caller can degrade gracefully (the PNG export still works
// fully offline). Returns { cmykMode } from the response for a user notice.
export async function exportPDF({ cmyk = false } = {}) {
  const d = dims(S);
  const c = document.createElement("canvas"); c.width = d.pxW; c.height = d.pxH;
  drawCover(c.getContext("2d"), DPI, false);
  const png_base64 = c.toDataURL("image/png").split(",")[1];

  const res = await fetch(API_BASE + "/api/export-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ png_base64, width_in: d.fullW, height_in: d.fullH, bleed_in: BLEED, cmyk }),
  });
  if (!res.ok) {
    let detail = res.status + " " + res.statusText;
    try { const j = await res.json(); if (j && j.error) detail = j.error; } catch (_) { /* non-JSON */ }
    throw new Error(detail);
  }
  const blob = await res.blob();
  dlBlob(blob, `kdp-wrap_${S.trimW}x${S.trimH}_${S.pages}pg_${d.pxW}x${d.pxH}_${cmyk ? "cmyk" : "rgb"}.pdf`);
  return { cmykMode: res.headers.get("X-CMYK-Mode") };
}
