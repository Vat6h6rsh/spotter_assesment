/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { heatTokens, heatHatch, severityTexture } from "./map/paint";

const css = readFileSync("src/themes.css", "utf8");

function palette(theme: string) {
  const tokens: Record<string, string> = {};
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map(s => s.trim());
    if (!selectors.includes(":root") && !selectors.includes(`:root[data-theme="${theme}"]`)) continue;
    for (const declaration of match[2].matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[declaration[1]] = declaration[2].trim();
  }
  return tokens;
}
function luminance(hex: string) {
  const linear = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
function contrast(a: string, b: string) {
  const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (light + .05) / (dark + .05);
}
describe("published theme contrast", () => {
  it.each(["01", "02", "04", "05", "06"])("theme %s meets text and non-text contrast", theme => {
    const t = palette(theme);
    for (const surface of ["bg", "surface", "surface2"]) {
      for (const text of ["text", "muted"]) expect(contrast(t[text], t[surface]), `${theme} ${text}/${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(t["on-primary"], t.primary), `${theme} primary text`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["nav-text"], t.nav), `${theme} nav text`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["map-text"], t.map), `${theme} map labels`).toBeGreaterThanOrEqual(4.5);
    for (const level of ["low", "moderate", "high", "severe", "stop", "unknown"]) {
      expect(contrast(t["on-severity"], t[level]), `${theme} monument header ${level}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t[level], t.surface), `${theme} ${level}/surface`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t[level], t.map), `${theme} ${level} map shape`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(t['on-accent'], t.accent), `${theme} Mausam title`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["control-border"], t.surface), `${theme} input border`).toBeGreaterThanOrEqual(3);
    expect(contrast(t["route-alt"], t.map), `${theme} alternative route`).toBeGreaterThanOrEqual(3);
  });
});

describe("validated corridor heat ramp", () => {
  it.each(["01", "02", "04", "05", "06"])("theme %s isolates heat from status tokens", theme => {
    const tokens = palette(theme);
    const heat = heatTokens(property => tokens[property.slice(2)]);
    const ramp = ["04", "05"].includes(theme)
      ? ["#EBA53E", "#EE6D35", "#D73C47", "#A82A60"]
      : ["#C98A12", "#CF4F19", "#AE1B2B", "#5E1240"];
    expect(heat).toEqual({ 0: "transparent", 1: ramp[0], 2: ramp[1], 3: ramp[2], 4: ramp[3], 255: "#808080" });
    expect(tokens["heat-opacity"]).toBe("1");
    expect(severityTexture(heat[0], 0).data.every(v => v === 0)).toBe(true);
    expect(heatHatch[4]).toBe(135);
    expect(heatHatch[255]).toBe(45);
    expect(heat[1]).not.toBe(tokens.moderate);
  });
});
