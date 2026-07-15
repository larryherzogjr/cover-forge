import test from "node:test";
import assert from "node:assert/strict";

import {
  S, PROJECT_VERSION, resetProject, restore, serialize, validateProject,
} from "../src/state.js";


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

test("restore validates a project, preserves references, and clears stale missing fields", () => {
  resetProject();
  S.title.text = "Saved title";
  const project = serialize();
  delete project.state.subtitle;
  const titleReference = S.title;
  S.title.text = "Unsaved title";
  S.subtitle.text = "Stale subtitle";

  restore(project);

  assert.equal(S.title, titleReference);
  assert.equal(S.title.text, "Saved title");
  assert.equal(S.subtitle.text, "");
});

test("project validation rejects future versions, unknown state, and unsafe image values", () => {
  resetProject();
  const project = serialize();

  assert.throws(
    () => validateProject({ ...project, version: PROJECT_VERSION + 1 }),
    /unsupported Cover Forge project version/,
  );
  assert.throws(
    () => validateProject({ ...project, state: { ...project.state, surprise: true } }),
    /state\.surprise is not supported/,
  );
  assert.throws(
    () => validateProject({ ...project, image: "https://example.test/image.png" }),
    /embedded base64 image/,
  );
});

test("project validation rejects invalid dimensions and overlay records", () => {
  resetProject();
  const project = serialize();
  assert.throws(
    () => validateProject({ ...project, state: { ...project.state, trimW: Infinity } }),
    /finite number/,
  );
  assert.throws(
    () => validateProject({
      ...project,
      state: { ...project.state, overlays: [{ id: "bad", src: "javascript:alert(1)", cx: 1, cy: 1, w: 1 }] },
    }),
    /embedded base64 image/,
  );
  const src = "data:image/png;base64,eA==";
  const duplicate = { id: "same", src, cx: 1, cy: 1, w: 1 };
  assert.throws(
    () => validateProject({
      ...project,
      state: { ...project.state, overlays: [duplicate, { ...duplicate }] },
    }),
    /duplicate ids/,
  );
});
