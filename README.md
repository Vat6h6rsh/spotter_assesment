# Spotter · Weather-Aware Truck Routing

A React + Django web app that helps a truck driver choose the **safest route** using **weather at the hour the
truck will actually be there**, **load weight** and **travel time**.

**Live app:** https://spotter-weather-route.pages.dev · **API docs:** https://spotter-weather-route-api.onrender.com/api/docs/
*(The API runs on free hosting and sleeps when idle; the first visit can take up to a minute while it wakes, and the app shows a wake-up card meanwhile.)*

---

## What it does

1. Enter origin, destination, departure time and cargo weight. A **"Today's toughest trucking weather"** popup can
   also autofill a real trip through the worst weather in the US right now, chosen from NWS alerts plus a forecast
   scan of freight corridors.
2. The backend asks **TomTom** for **3 truck routes**, places checkpoints every **10 / 25 / 50 miles**, and works out
   each checkpoint's **ETA**:
   - including traffic;
   - including driving rests (30 min after 8 h, 10 h after 11 h, or the driver's own plan);
   - including **weather slowdowns** (FHWA rain and snow speed reductions, iterated to a fixed point).
3. At each checkpoint it reads the **Open-Meteo** forecast **for that ETA hour** and rates wind (gust or sustained),
   rain and snow with the assessment's **risk table and load rules** (Low → Moderate → High → Severe → No Travel).
4. It **recommends** a route by: no No Travel miles → fewest **Severe** miles → fewest **High** miles → lowest
   **average risk** → shortest **time** (with a sampling tolerance so noise can't override hours). If waiting helps,
   it suggests a later departure ("Leave 3 h later on C").
5. The **map** shows:
   - all routes, checkpoints (with place names like *"I-10 E · 7 mi NW of Casas Adobes, AZ"*), risk levels, ETAs
     and route summaries;
   - a **corridor weather heatmap** with a **0–48 h forecast slider**.
6. **Play** runs a **drive preview**: a 3D truck drives the selected route with a chase camera, weather cards pop at
   risky checkpoints ("Travel not recommended · Clear roads in about 6 h"), and music plays.

## Assessment requirements → where they are

| Requirement | Implementation |
| --- | --- |
| Origin, destination, departure, load weight | Plan form; departure is in the origin's local time |
| 3 route options via a routing API | TomTom Routing (truck mode, cargo + tare weight); keyless OSRM fallback, labelled |
| Sample weather every 10 / 25 / 50 mi at the ETA | Checkpoints by road distance; ETA from TomTom timing + rests + weather slowdown |
| Risk from the provided rules | `backend/planner/domain/risk.py`, with table-driven tests at every boundary |
| Recommend balancing risk and time | `backend/planner/domain/recommend.py`, successive filtering with tolerance |
| Routes, checkpoints, risk, ETAs and summaries on a map | MapLibre: risk-coloured routes, checkpoint markers, ETA labels and popups, route summary pills |
| Weather heatmap along the corridor with a 0–48 h slider | H3 hex corridor, 49 hourly frames as 1 byte per cell-hour; scrubbing never hits the network |

## Architecture

```
React (Vite, TS, MapLibre, three.js lazy)  ──HTTPS/JSON──▶  Django + DRF
   plan form · map · slider · drive preview                    ├─ TomTom (routes, search)  → OSRM / Open-Meteo / Photon fallbacks
   Cloudflare Pages                                            ├─ Open-Meteo (forecast, cached per H3 cell)
                                                               ├─ NWS alerts (hotspot popup)
                                                               └─ pure-Python domain: risk · geometry · ETA · recommend
                                                               Render (free)
```

- **Domain logic is pure Python** (`backend/planner/domain/`), with no Django or I/O, so it is fast to test.
- **Weather is cached per H3 res-5 cell** (about 8.5 km) for the whole 8-day series, so routes and users share
  lookups, and changing the departure costs no new calls.
- **Resilience:** timeouts, retries with jitter, circuit breakers, singleflight (stampede protection), a daily weather
  budget, and **Unknown is never treated as Low**.
- **Compact payloads:** encoded polylines and a byte-packed heatmap: about 16 KB gzip for a 3-route plan.

## Run locally

**Backend** (Python 3.13):
```bash
cd backend
python -m venv .venv && . .venv/Scripts/activate      # Windows; on macOS/Linux: . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env                                   # add TOMTOM_API_KEY (optional; OSRM fallback without it)
python manage.py runserver 8000                        # API docs: http://localhost:8000/api/docs/
pytest -q
```

**Frontend** (Node 22+):
```bash
cd frontend
npm install
npm run dev                                            # http://localhost:5173  (VITE_USE_MOCK=1 for offline demo data)
npx vitest run && npm run build && npm run lint
```

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Status, active providers, weather budget |
| `GET /api/geocode?q=Joliet` | Place search (US/Canada) with time zone |
| `POST /api/plans` | Routes, checkpoints, risk, recommendation and departure advice |
| `GET /api/plans/<id>/heatmap` | Corridor heatmap: 49 hourly frames |
| `GET /api/plans/<id>/truck-route` | Whether the slower truck-aware route is ready (the app shows a car route meanwhile) |
| `GET /api/weather/hotspot` | Today's toughest trucking weather, with verified showcase trips |

Full OpenAPI docs with examples are at `/api/docs/` (Swagger) and `/api/redoc/`.

## Tests

- **Backend:** 325 pytest tests (offline via recorded fixtures), including table-driven risk boundaries, the
  recommendation comparator, rest and ETA maths, weather slowdowns, place labels, the hotspot, and an API-docs drift
  test.
- **Frontend:** 195 vitest tests: map paint and filters, slider maths, camera rules, drive preview, audio, themes and
  fonts.

## Credits

Routing and search: TomTom. Forecasts: Open-Meteo. Alerts: US National Weather Service. Basemap: OpenFreeMap /
OpenStreetMap. Place names: GeoNames (CC BY 4.0). Weather icons: Meteocons by Bas Milius (MIT). UI icons: Tabler
Icons (MIT). Truck model: "Truck with trailer" by Rgsdev (CC0). Fonts: IBM Plex Sans, Atkinson Hyperlegible Next,
Manrope, Source Sans 3 (OFL). Music: see `frontend/public/audio/CREDITS.txt`.
