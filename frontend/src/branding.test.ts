import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("ships the supplied logo byte for byte, preserves Spotter's favicon/PWA set, and removes the old mark", () => {
  const root = process.cwd();
  expect(readFileSync(resolve(root, "public/spotter-ai-logo.webp"))).toEqual(readFileSync(resolve(root, "../spotter-ai-logo.webp")));
  const obsolete = `spotter-${"mark"}.svg`;
  expect(existsSync(resolve(root, `public/${obsolete}`))).toBe(false);
  for (const file of ["index.html", "vite.config.ts", "src/App.tsx"]) {
    const source = readFileSync(resolve(root, file), "utf8");
    expect(source).not.toContain(obsolete);
  }
  expect(readFileSync(resolve(root, "src/App.tsx"), "utf8")).toContain("spotter-ai-logo.webp");
  const html = readFileSync(resolve(root, "index.html"), "utf8");
  const config = readFileSync(resolve(root, "vite.config.ts"), "utf8");
  for (const icon of ["favicon-96x96.png", "favicon.svg", "apple-touch-icon.png"]) {
    expect(existsSync(resolve(root, "public", icon))).toBe(true);
    expect(html).toContain(icon); expect(config).toContain(icon);
  }
  expect(html).toContain("favicon.ico"); expect(existsSync(resolve(root, "public/favicon.ico"))).toBe(true);
});
