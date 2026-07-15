import test from "node:test";
import assert from "node:assert/strict";

import { dims, PAPER, safeArea, barcodeBox } from "../src/kdp.js";
import { layoutIssues, riskyColorLabels } from "../src/preflight.js";
import { S } from "../src/state.js";

const cloneState = () => JSON.parse(JSON.stringify(S));

test("layout pre-flight catches text outside safe areas and overlays in the barcode zone", () => {
  const state = cloneState();
  state.tagline.text = "Back hook";
  state.overlays = [{ id: "logo" }];
  const d = dims(state), scale = 100;
  const frontSafe = safeArea(d, "front");
  const barcode = barcodeBox(d);
  const boxes = new Map([
    ["title", { x: frontSafe.x * scale - 20, y: frontSafe.y * scale, w: 100, h: 50 }],
    ["tagline", { x: barcode.left * scale, y: barcode.top * scale, w: 100, h: 50 }],
    ["overlay:logo", { x: barcode.left * scale, y: barcode.top * scale, w: 50, h: 50 }],
  ]);

  const issues = layoutIssues(state, d, scale, (token) => boxes.get(token));

  assert.ok(issues.includes("title crosses the front safe area"));
  assert.ok(issues.includes("back tagline overlaps the barcode zone"));
  assert.ok(issues.includes("overlay layer 1 overlaps the barcode zone"));
});

test("color pre-flight includes gradients, optional blocks, and active outlines", () => {
  const state = cloneState();
  state.bgMode = "gradient";
  state.gradient.from = "#ff0000";
  state.gradient.to = "#0e1a2b";
  state.subtitle.text = "Subtitle";
  state.subtitle.color = "#00ff66";
  state.author.stroke.width = 2;
  state.author.stroke.color = "#0000ff";
  state.back.text = "";
  state.spine.text = "";

  const risky = riskyColorLabels(state);

  assert.ok(risky.includes("gradient start"));
  assert.ok(risky.includes("subtitle"));
  assert.ok(risky.includes("author outline"));
});
