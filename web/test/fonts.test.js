import test from "node:test";
import assert from "node:assert/strict";

import { COVER_FONT_GROUPS, COVER_FONTS } from "../src/fonts.js";


test("cover font catalog is grouped, unique, and includes the expanded families", () => {
  assert.deepEqual(COVER_FONT_GROUPS.map((group) => group.label), ["Serif", "Sans / display"]);
  assert.equal(new Set(COVER_FONTS).size, COVER_FONTS.length);
  assert.equal(COVER_FONTS.length, 18);

  for (const family of [
    "Lora", "Merriweather", "Crimson Pro", "DM Serif Display", "Cinzel",
    "Roboto Slab", "Raleway", "Poppins", "Anton", "League Spartan",
  ]) {
    assert.ok(COVER_FONTS.includes(family), `${family} should be available`);
  }
});
