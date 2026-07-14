import test from "node:test";
import assert from "node:assert/strict";

import { S, resetProject, serialize } from "../src/state.js";


test("resetProject creates a blank cover and preserves bound object references", () => {
  const titleReference = S.title;
  const gradientReference = S.gradient;

  S.trimW = 8.5;
  S.title.text = "Old title";
  S.author.text = "Old author";
  S.spine.text = "Old spine";
  S.back.text = "Old blurb";
  S.img = { src: "data:image/png;base64,old" };
  S.palette = ["#ffffff"];
  S.overlays = [{ id: "old-overlay", src: "data:image/png;base64,old" }];
  S.selected = "title";

  resetProject();

  assert.equal(S.title, titleReference);
  assert.equal(S.gradient, gradientReference);
  assert.equal(S.trimW, 6);
  assert.equal(S.title.text, "");
  assert.equal(S.author.text, "");
  assert.equal(S.spine.text, "");
  assert.equal(S.back.text, "");
  assert.equal(S.img, null);
  assert.deepEqual(S.palette, []);
  assert.deepEqual(S.overlays, []);
  assert.equal(S.selected, null);
  assert.equal(serialize().image, null);
});
