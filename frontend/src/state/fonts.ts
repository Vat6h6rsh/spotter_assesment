import { useSyncExternalStore } from "react";

export const FONTS = {
  plex: {
    label: "IBM Plex Sans",
    family: '"IBM Plex Sans Variable"',
    description: "Industrial and clear · Default",
    // The default CSS is imported once, statically, in main.tsx.
    load: () => Promise.resolve(),
  },
  atkinson: {
    label: "Atkinson Hyperlegible Next",
    family: '"Atkinson Hyperlegible Next Variable"',
    description: "Distinct letters for easier reading",
    load: () => import("@fontsource-variable/atkinson-hyperlegible-next/wght.css"),
  },
  manrope: {
    label: "Manrope",
    family: '"Manrope Variable"',
    description: "Geometric and open",
    load: () => import("@fontsource-variable/manrope/wght.css"),
  },
  source: {
    label: "Source Sans 3",
    family: '"Source Sans 3 Variable"',
    description: "Compact and familiar",
    load: () => import("@fontsource-variable/source-sans-3/wght.css"),
  },
} as const;

export type FontId = keyof typeof FONTS;
export const FONT_KEY = "spotter.font.v05";
export const FONT_SAMPLE = "Fri 11:00 AM · 28h 26m · 1,130 mi · 0.25 in/hr";

export function readFont(storage?: Pick<Storage, "getItem">): FontId {
  try {
    const value = (storage ?? localStorage).getItem(FONT_KEY);
    return value && Object.hasOwn(FONTS, value) ? (value as FontId) : "plex";
  } catch {
    return "plex";
  }
}

export function saveFont(id: FontId, storage?: Pick<Storage, "setItem">) {
  try {
    (storage ?? localStorage).setItem(FONT_KEY, id);
    return true;
  } catch {
    return false;
  }
}

interface FontState {
  id: FontId;
  pending: FontId | null;
  error: string | null;
}

let current: FontState = { id: "plex", pending: null, error: null };
let selection = 0;
const listeners = new Set<() => void>();
function publish(next: FontState) {
  current = next;
  listeners.forEach((listener) => listener());
}

export const fonts = {
  get: () => current,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  async select(id: FontId): Promise<boolean> {
    const request = ++selection;
    publish({ ...current, pending: id, error: null });
    try {
      await FONTS[id].load();
      if (request !== selection) return false;
      // Wait for the actual Latin glyphs, not just the font's stylesheet.
      if (document.fonts?.load) {
        await Promise.all(
          [400, 500, 600].map((weight) =>
            document.fonts.load(`${weight} 14px ${FONTS[id].family}`, FONT_SAMPLE),
          ),
        );
      }
      if (request !== selection) return false;
      document.documentElement.dataset.font = id;
      saveFont(id);
      publish({ id, pending: null, error: null });
      return true;
    } catch {
      if (request !== selection) return false;
      document.documentElement.dataset.font = current.id;
      publish({
        ...current,
        pending: null,
        error: "That typeface could not be loaded. Try again when connected.",
      });
      return false;
    }
  },
};

/** main.tsx waits for a saved alternate before mounting the interface. */
export async function initializeFont() {
  await fonts.select(readFont());
}

export const useFont = () =>
  useSyncExternalStore(fonts.subscribe, fonts.get, fonts.get);
