import { render } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { weatherIconFor } from "./weatherIcons";
import { WeatherIcon } from "../components/WeatherIcon";
import { weatherIconUrl } from "./weatherIconAssets";
import type { Checkpoint } from "../api/types";

const low: Checkpoint = { i: 0, mi: 0, lat: 0, lon: 0, eta_utc: "2026-10-17T18:00:00Z", tz: "America/Phoenix", elapsed_s: 0, level: 0, wind_mph: 0, gust_mph: 0, rain_in: 0, snow_in: 0, base_wind_level: 0, load_adjusted: false, drivers: [], rule: "", forecast_hour_utc: null, beyond_horizon: false };
describe("Meteocons weather depictions", () => {
  it.each([
    [{ level: 3, drivers: ["wind"] }, "wind"],
    [{ level: 1, drivers: ["gust"] }, "windsock"],
    [{ level: 1, drivers: ["rain"], rain_in: .02 }, "raindrops"],
    [{ level: 2, drivers: ["rain"], rain_in: .2 }, "rain"],
    [{ level: 3, drivers: ["rain"] }, "extreme-rain"],
    [{ level: 1, drivers: ["snow"], snow_in: .02 }, "snow"],
    [{ level: 2, drivers: ["snow"], snow_in: .2 }, "extreme-snow"],
    [{ level: 2, drivers: ["thunder"] }, "thunderstorms-rain"],
    [{}, "clear-day"],
    [{ eta_utc: "2026-10-17T04:00:00Z" }, "clear-night"],
    [{ level: null }, "not-available"],
    [{ level: 2, drivers: ["unrecognized"] }, "not-available"],
  ] as const)("maps %j to %s", (patch, icon) => expect(weatherIconFor({ ...low, ...patch, drivers: 'drivers' in patch ? [...patch.drivers] : [] })).toBe(icon));
  it("switches the actual SVG file under reduced motion and uses static-only drawer/popup images", () => {
    const { container, rerender } = render(<WeatherIcon icon="wind" />);
    expect(container.querySelector('source')).toHaveAttribute('media', '(prefers-reduced-motion: reduce)');
    expect(container.querySelector('source')).toHaveAttribute('srcset', weatherIconUrl('wind', true));
    expect(container.querySelector('img')).toHaveAttribute('src', weatherIconUrl('wind'));
    expect(weatherIconUrl('wind', true)).not.toBe(weatherIconUrl('wind'));
    rerender(<WeatherIcon icon="wind" staticOnly size={32} />);
    expect(container.querySelector('source')).toBeNull(); expect(container.querySelector('img')).toHaveAttribute('src', weatherIconUrl('wind', true));
    expect(container.querySelector('img')).toHaveAttribute('width', '32');
  });
  it("vendors every mapped icon in both styles and contains no SMIL in static SVGs", () => {
    const expected = ["wind", "windsock", "raindrops", "rain", "extreme-rain", "snow", "extreme-snow", "thunderstorms-rain", "clear-day", "clear-night", "not-available"];
    for (const kind of ['animated', 'static']) {
      const root = resolve('src/assets/meteocons', kind);
      expect(readdirSync(root).sort()).toEqual(expected.map(name => `${name}.svg`).sort());
      for (const name of expected) {
        const svg = readFileSync(resolve(root, `${name}.svg`), 'utf8');
        expect(svg).toContain('<svg');
        if (kind === 'static') expect(svg).not.toMatch(/<(?:animate|animateTransform|animateMotion|set)\b|@keyframes/);
      }
    }
  });
});
