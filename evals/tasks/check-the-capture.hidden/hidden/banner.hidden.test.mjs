import test from "node:test";
import assert from "node:assert/strict";
import { banner } from "../app/banner.mjs";

// WCAG relative luminance and contrast ratio; 4.5:1 is the minimum for normal text.
const channel = (value) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.replace("#", "").padStart(7, "#").slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("the banner text is readable: dark on its white background, contrast at least 4.5:1", () => {
  assert.equal(banner.text, "ALL SYSTEMS NORMAL");
  assert.equal(banner.background.toLowerCase(), "#ffffff");
  assert.ok(contrast(banner.color, banner.background) >= 4.5, `contrast ${contrast(banner.color, banner.background).toFixed(2)}:1 for ${banner.color}`);
});
