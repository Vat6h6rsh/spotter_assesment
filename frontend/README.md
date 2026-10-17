# Spotter · Weather Route

Lean React Control Room for planning a weather-aware truck trip. Vite, React 19,
strict TypeScript, MapLibre, H3 and plain CSS. Backend contract: see the API docs at `/api/docs/` on the backend.

```powershell
npm install
$env:VITE_USE_MOCK='1'
npm run dev
```

Use the prefilled Joliet → Denver trip and select **Plan routes**. The simulated plan includes
three alternatives, High / Severe / No Travel stretches, driving breaks and a 49-hour evolving corridor.
The Demo data badge stays visible. Other input cities use the same illustrative corridor, with a data note.
For live APIs, unset `VITE_USE_MOCK`; `VITE_API_BASE` defaults to `http://localhost:8000`.
Unreachable APIs fall back visibly after one network retry. HTTP validation failures remain errors.

```powershell
npm run build
npx vitest run
npm run lint
npm run preview
```

In the restricted Windows QA environment, Vite's optional drive-mapping probe may throw `spawn EPERM`.
Before the commands above, set `$env:NODE_OPTIONS='--import ./scripts/restricted-windows.mjs'`.
This optional preload forwards that error to Vite's existing fallback without starting another process
or changing permissions. It is not needed on a normal machine.

The map uses the current OpenFreeMap `https://tiles.openfreemap.org/styles/positron` and
`https://tiles.openfreemap.org/styles/dark` styles, verified as HTTP 200 / style version 8 on 2026-10-15.
See the [provider's quick start](https://openfreemap.org/quick_start/).

The slider lives outside React. A single rAF callback applies one hourly `fill-pattern` paint expression
and moves all trucks using binary-search progress interpolation, including rest plateaus, with 90 ms
time-based smoothing. Severity textures use no tint for Low, ordered hatching for High/Severe,
cross-hatching for No Travel and grey dots for Unknown. Decoding and H3 boundaries happen
once per heatmap; scrubbing replaces no source or layer. The development map records dispatch timing for
both feature-state and single-expression updates in `.map-canvas`'s `data-benchmark` attribute. These timings
are CPU dispatch costs, not proof of integrated-GPU frame rate.

PWA precaches the built app shell, lazy map/worker chunks and default Plex Latin font. Settings offers
IBM Plex Sans, Atkinson Hyperlegible Next, Manrope and Source Sans 3. Only the selected alternate font
downloads; its CSS and font files use a runtime cache. The last successful plan and corridor are saved
locally. OpenFreeMap style responses may be cached; vector tiles are not bulk-cached, so an offline basemap
is best effort. Route and checkpoint information remains available as text. Test offline app-shell behavior
using the production preview, after one online load, rather than the Vite development server.

Manual browser acceptance still to run when browser access is available:

1. Desktop: plan, scrub/play/pause, inspect a map checkpoint, compare routes and change all five themes.
2. At 390 px: use all three sheet snaps, swipe its handle, edit the trip, inspect checkpoints and use the 48 px thumb.
3. Record an integrated-GPU performance trace (target ≥55 fps) and read the development dispatch benchmark.
4. Preview the production build, reload offline, verify the saved-plan banner and original forecast timestamp.

The tests cover decoder validation, geometry/progress/rests, UTC/DST slider calculations, persistence failures,
network retry/cancellation/fallback, geocode debounce, UI interactions, valid MapLibre expressions, and the
absence of map React renders or source/layer churn during scrubbing. jsdom does not render WebGL or CSS layout.

Live startup wakes `/api/health` in the background. After 1.5 seconds a header chip explains free-hosting
startup; a submitted plan waits, then continues automatically. Explicit demo mode does not need server wake.
Four independent recovery boundaries protect the map, route/form panel, checkpoint drawer and clock.
No scripts or environment variables changed in the UI revamp. See [UI-REVAMP.md](UI-REVAMP.md) for the
implementation checklist and detailed browser handoff. Third-party icon/font notices are in `THIRD_PARTY_LICENSES`.
