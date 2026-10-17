import { useSyncExternalStore } from "react";
import type { RestPlan, Spacing, WindMeasure } from "../api/types";
export const themes = [
  {
    id: "01",
    name: "Brand daylight",
    mode: "Light",
    colors: ["#F3F8F8", "#FFFFFF", "#15363C", "#008080", "#F8485F"],
  },
  {
    id: "02",
    name: "Glacier & ink",
    mode: "Light",
    colors: ["#E7F0F1", "#F9FCFC", "#172E3C", "#145D68", "#F8485F"],
  },
  {
    id: "04",
    name: "Midnight teal",
    mode: "Dark",
    colors: ["#101F26", "#172C33", "#0B191F", "#BBDDDE", "#F8485F"],
  },
  {
    id: "05",
    name: "Charcoal & coral",
    mode: "Dark",
    colors: ["#191D23", "#242A32", "#12161B", "#F8485F", "#BBDDDE"],
  },
  {
    id: "06",
    name: "Harbor contrast",
    mode: "Light",
    colors: ["#EBF0F3", "#FFFFFF", "#142B3C", "#008080", "#F8485F"],
  },
] as const;
export type Theme = "system" | (typeof themes)[number]["id"];
export interface Preferences {
  theme: Theme;
  spacing: Spacing;
  wind: WindMeasure;
  rest: RestPlan;
  weatherSlowdown: boolean;
  drivePreview: boolean;
}
export const defaultPreferences: Preferences = {
  theme: "system",
  spacing: 25,
  wind: "gust",
  rest: { mode: "auto" },
  weatherSlowdown: true,
  drivePreview: true,
};
export const PREFERENCES_KEY = "spotter.preferences.v05";
export function readPreferences(
  storage?: Pick<Storage, "getItem">,
): Preferences {
  try {
    const value = JSON.parse(
      (storage ?? localStorage).getItem(PREFERENCES_KEY) || "null",
    );
    if (!value || typeof value !== "object") return { ...defaultPreferences };
    const theme =
      value.theme === "system" || themes.some((t) => t.id === value.theme)
        ? value.theme
        : "system";
    const spacing = [10, 25, 50].includes(value.spacing) ? value.spacing : 25;
    const wind = value.wind === "sustained" ? "sustained" : "gust";
    let rest: RestPlan = { mode: "auto" };
    if (value.rest?.mode === "none") rest = { mode: "none" };
    if (
      value.rest?.mode === "custom" &&
      value.rest.drive_hours >= 1 &&
      value.rest.drive_hours <= 11 &&
      value.rest.rest_hours >= 0.5 &&
      value.rest.rest_hours <= 34
    )
      rest = value.rest;
    const weatherSlowdown = value.weatherSlowdown !== false;
    return { theme, spacing, wind, rest, weatherSlowdown, drivePreview: value.drivePreview !== false };
  } catch {
    return { ...defaultPreferences };
  }
}
export function savePreferences(
  value: Preferences,
  storage?: Pick<Storage, "setItem">,
) {
  try {
    (storage ?? localStorage).setItem(PREFERENCES_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function resolveTheme(theme: Theme, dark: boolean) {
  return theme === "system" ? (dark ? "04" : "02") : theme;
}
let current = readPreferences();
const listeners = new Set<() => void>();
export const preferences = {
  get: () => current,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  update(patch: Partial<Preferences>) {
    current = { ...current, ...patch };
    savePreferences(current);
    applyTheme();
    listeners.forEach((fn) => fn());
  },
};
export function applyTheme() {
  document.documentElement.dataset.theme = resolveTheme(
    current.theme,
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
}
export function initializeTheme() {
  applyTheme();
  const media = matchMedia("(prefers-color-scheme: dark)");
  const listener = () => {
    if (current.theme === "system") {
      current = { ...current }; // A changed system mode must also refresh the map's theme prop.
      applyTheme();
      listeners.forEach((fn) => fn());
    }
  };
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
export const usePreferences = () =>
  useSyncExternalStore(preferences.subscribe, preferences.get);
