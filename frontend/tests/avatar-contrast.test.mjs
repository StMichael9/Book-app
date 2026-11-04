import test from "node:test";
import assert from "node:assert/strict";
import { AVATAR_COLOURS, AVATAR_DARK, AVATAR_LIGHT, AVATAR_WHITE, avatarInk, contrast } from "../src/components/profile/avatarColours.js";

// Native Node test: no browser. Run with: node --test tests/avatar-contrast.test.mjs
test("every avatar colour gets a glyph and initials ink that reads at 4.5:1 or better", () => {
  assert.equal(AVATAR_COLOURS.length, 6);
  for (const [key, , hex] of AVATAR_COLOURS) {
    const ink = avatarInk(hex);
    assert.ok(contrast(ink, hex) >= 4.5, `${key}: ${ink} on ${hex} is ${contrast(ink, hex).toFixed(2)}:1`);
    assert.ok([AVATAR_LIGHT, AVATAR_WHITE, AVATAR_DARK].includes(ink));
  }
});

test("mustard takes the dark ink, because the light ink is below 4.5:1 on it", () => {
  const mustard = AVATAR_COLOURS.find(([key]) => key === "mustard")[2];
  assert.ok(contrast(AVATAR_LIGHT, mustard) < 4.5);
  assert.equal(avatarInk(mustard), AVATAR_DARK);
});

test("only mustard takes the dark ink and only sage takes white; the other four keep the warm light ink", () => {
  const inks = Object.fromEntries(AVATAR_COLOURS.map(([key, , hex]) => [key, avatarInk(hex)]));
  assert.deepEqual(inks, { green: AVATAR_LIGHT, rust: AVATAR_LIGHT, ink: AVATAR_LIGHT, mustard: AVATAR_DARK, plum: AVATAR_LIGHT, sage: AVATAR_WHITE });
});
