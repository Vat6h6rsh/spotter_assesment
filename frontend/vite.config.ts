import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { localAudio } from "./scripts/local-audio.ts";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    localAudio(),
    {
      name: 'reject-private-music-build', apply: 'build', enforce: 'pre',
      load(id) {
        if (/(?:^|[\\/])local-audio[\\/]/i.test(id)) throw new Error('Private local-audio cannot be imported into a production build.');
      },
      generateBundle(_options, bundle) {
        const checked = new Set<string>();
        const visit = (file: string) => {
          if (checked.has(file)) return; checked.add(file);
          const chunk = bundle[file]; if (!chunk || chunk.type !== 'chunk') return;
          if (Object.keys(chunk.modules).some(id => /[\\/]node_modules[\\/]three[\\/]/.test(id)))
            throw new Error('three.js entered the eager app dependency graph.');
          chunk.imports.forEach(visit); // Deliberately excludes dynamicImports.
        };
        Object.values(bundle).filter(chunk => chunk.type === 'chunk' && chunk.isEntry).forEach(chunk => visit(chunk.fileName));
        console.log('Bundle boundary passed (three.js is outside the eager app graph).');
      },
    },
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["spotter-ai-logo.webp"],
      manifest: {
        name: "Spotter Weather Route",
        short_name: "Weather Route",
        description: "Weather-aware truck route planning.",
        start_url: "/",
        display: "standalone",
        background_color: "#E7F0F1",
        theme_color: "#172E3C",
        icons: [
          { src: "/favicon-96x96.png", sizes: "96x96", type: "image/png", purpose: "any" },
          { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
          { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      workbox: {
        globPatterns: [
          "**/*.{js,mjs,css,html,svg,webmanifest}",
          "**/ibm-plex-sans-latin-wght-normal-*.woff2",
        ],
        // Async Fontsource imports emit wght-*.css. Keep alternates genuinely lazy.
        globIgnores: ["**/wght-*.css", "**/drive-3d-*.js", "**/truckLayer-*.js", "**/local-audio/**", "**/models/**", "**/audio/**"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        // Explicitly no API-response caching: the last successful plan is saved by the app.
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(?:drive-3d|truckLayer)-[^/]+\.js$/,
            handler: "CacheFirst",
            options: { cacheName: "drive-renderer", expiration: { maxEntries: 2, maxAgeSeconds: 31536000 } },
          },
          {
            urlPattern: /\/(?:models\/semi-truck\/.*\.(?:glb|gltf|bin|png|jpe?g|webp)|audio\/(?:gnossienne-no-1|mausam-aaj-tak)\.mp3)$/,
            handler: "CacheFirst",
            options: { cacheName: "drive-assets", expiration: { maxEntries: 24, maxAgeSeconds: 2592000 } },
          },
          {
            urlPattern: /\/assets\/(?:wght-[^/]+\.css|[^/]+\.woff2?)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "ui-fonts",
              expiration: { maxEntries: 16, maxAgeSeconds: 31536000 },
            },
          },
          {
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/styles\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "openfreemap-styles",
              expiration: { maxEntries: 3, maxAgeSeconds: 604800 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: { output: { manualChunks(id) {
      if (id.includes('/node_modules/three/')) return 'drive-3d';
    } } },
  },
});
