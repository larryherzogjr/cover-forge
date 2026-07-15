// preflight.js — pure print-safety checks over rendered bounds and design state.
// DOM/canvas ownership stays in ui.js/render.js; callers provide recorded hit
// boxes so this module remains unit-testable in Node.

import {
  barcodeBox, cmykRisk, rectContains, rectIntersects, safeArea,
  spineTextAllowed,
} from "./kdp.js";

export const FRONT_BLOCKS = ["series", "title", "subtitle", "pullquote", "author"];
export const BACK_BLOCKS = ["tagline", "bio"];
export const BLOCK_LABELS = {
  series: "series", title: "title", subtitle: "subtitle", pullquote: "pull-quote",
  author: "author", tagline: "back tagline", bio: "author bio",
};

export const isBackBlock = (token) => BACK_BLOCKS.includes(token);

export function layoutIssues(state, d, scale, getHitBox) {
  const issues = [];
  const bc = barcodeBox(d);
  const bcPx = { x: bc.left * scale, y: bc.top * scale, w: bc.w * scale, h: bc.h * scale };
  for (const token of [...FRONT_BLOCKS, ...BACK_BLOCKS]) {
    if (!state[token].text.trim()) continue;
    const hit = getHitBox(token); if (!hit) continue;
    const side = isBackBlock(token) ? "back" : "front";
    const safe = safeArea(d, side);
    const safePx = { x: safe.x * scale, y: safe.y * scale, w: safe.w * scale, h: safe.h * scale };
    if (!rectContains(safePx, hit, 1)) issues.push(`${BLOCK_LABELS[token]} crosses the ${side} safe area`);
    if (side === "back" && rectIntersects(hit, bcPx)) issues.push(`${BLOCK_LABELS[token]} overlaps the barcode zone`);
  }
  for (let i = 0; i < state.overlays.length; i++) {
    const hit = getHitBox("overlay:" + state.overlays[i].id);
    if (hit && rectIntersects(hit, bcPx)) issues.push(`overlay layer ${i + 1} overlaps the barcode zone`);
  }
  return issues;
}

export function riskyColorLabels(state) {
  const labels = [];
  if (state.bgMode === "gradient") labels.push(["gradient start", state.gradient.from], ["gradient end", state.gradient.to]);
  else labels.push(["base color", state.bg]);
  for (const token of [...FRONT_BLOCKS, ...BACK_BLOCKS]) {
    const block = state[token];
    if (!block.text.trim()) continue;
    labels.push([BLOCK_LABELS[token], block.color]);
    if (block.stroke && block.stroke.width > 0) labels.push([`${BLOCK_LABELS[token]} outline`, block.stroke.color]);
  }
  if (state.back.text.trim()) labels.push(["back text", state.back.color]);
  if (state.spine.text.trim() && spineTextAllowed(state.pages)) labels.push(["spine", state.spine.color]);
  return labels.filter(([, hex]) => cmykRisk(hex)).map(([name]) => name);
}
