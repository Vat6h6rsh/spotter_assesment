# Meteocons weather depictions

Source: [Bas Milius / weather-icons](https://github.com/basmilius/weather-icons).
Style: **fill**. Licence: MIT; the original notice is in [LICENSE](LICENSE), also copied into
`frontend/THIRD_PARTY_LICENSES` and credited in Settings.

**Pinned by content (2026-10-17):** the upstream `dev` branch these files came from no longer exists on GitHub
(heads are `main` and `v2`; tags `v2.0.0` and `3.0.0-next.*` do not contain identical files), but jsDelivr still serves
it and all 22 files match it byte for byte. Because no tag or commit can reproduce them, the pin is the SHA-256 of each
vendored file below. Files are served from this repo only (no runtime CDN).

| File | SHA-256 |
|---|---|
| `animated/clear-day.svg` | `3b7a38947f1a3f0e083b854613dfccc48583ee153a48637779818791f65fd4c5` |
| `animated/clear-night.svg` | `c0ede715183a424dd3ff5a9324897406be7d4fad0a79834edd5bd2332c4bc861` |
| `animated/extreme-rain.svg` | `470d2c31f6a0ae16fee4ff225431948fc0b2dc3914308ce9d1b2d85462ca340c` |
| `animated/extreme-snow.svg` | `aad0e378f83e683fa1b1b16329af2120092acc53f2ac26fc5e274152dfd8eb67` |
| `animated/not-available.svg` | `b29dee909ac1091fc265a0782f01990249570502547588fcf2dd86e4280ebc6b` |
| `animated/rain.svg` | `572f8517ca97a972cf794096364a1907f10abd043d5799b10e6972e7a825f6e6` |
| `animated/raindrops.svg` | `7391bb31451cd2ae9a5a4e96f178adab5f8cc3e89ca728d5975967a23ab1b27f` |
| `animated/snow.svg` | `0d3dbd3fc2a5f17dd7f1517f54107a0ea90d63906e857ae2080be09fd15e4dc6` |
| `animated/thunderstorms-rain.svg` | `85c45e74e841e203cf2304757272152e8c4d210e7aa6e6856173605cd3528bf3` |
| `animated/wind.svg` | `d8482aefe9673ab5c3fc547547d2d48cd39d2d9bb430704023335e6faf5fecef` |
| `animated/windsock.svg` | `568c10ad7a509f6218cfd9ac1b35b3f6fe7d5d8182d8cd2335fdf01868616ebc` |
| `static/clear-day.svg` | `3a0993a8eaa71c24f09043ca0ec8996856e85f372d471a69466f698e3d9718b2` |
| `static/clear-night.svg` | `c53d60ed3bb60e6cf56ebecb5080190a719c98a4f630ebd32e1c3fbe064cb049` |
| `static/extreme-rain.svg` | `3a942332d4fcbe6edd9e05ac6ffca5fb3dce9752731978d7f666cdf5e1ca53e0` |
| `static/extreme-snow.svg` | `bf03eb7f51195594cc8fea8554198f0c531365337edfb1f977344140a87a550c` |
| `static/not-available.svg` | `b29dee909ac1091fc265a0782f01990249570502547588fcf2dd86e4280ebc6b` |
| `static/rain.svg` | `b5e31bd97540dab95ce0f59e7e6fc01097f4b6f039060debeae12a3463cd080b` |
| `static/raindrops.svg` | `15bab1189513793846d5fb7c2bf0e307bba20f0f5d5ea4bba1b085fe45ed3c0b` |
| `static/snow.svg` | `6722935203d0d3db4d3b3535eef605bc460f7ed958326890ef7559898494b85c` |
| `static/thunderstorms-rain.svg` | `d0ef33d411a72fd63db90283463ea58f5677b6eb55590a30f28e5b5764a1f9dd` |
| `static/wind.svg` | `dd7f7b8856defe50576dae15c78ddff2cfdbbb6e48ff208dbf4dc31331c36157` |
| `static/windsock.svg` | `426873e3c51e2853db5797d5d32ec8620319a25d206a2dfc90bb843acbcac9be` |

Original download templates (no CDN access occurs at runtime):

- `https://cdn.jsdelivr.net/gh/basmilius/weather-icons@dev/production/fill/svg/{name}.svg` → `animated/`
- `https://cdn.jsdelivr.net/gh/basmilius/weather-icons@dev/production/fill/svg-static/{name}.svg` → `static/`

The same eleven files exist in **each** directory (22 SVGs total), unmodified:

- `wind.svg`
- `windsock.svg`
- `raindrops.svg`
- `rain.svg`
- `extreme-rain.svg`
- `snow.svg`
- `extreme-snow.svg`
- `thunderstorms-rain.svg`
- `clear-day.svg`
- `clear-night.svg`
- `not-available.svg`

`WeatherIcon` uses a native `<picture>` source to select static artwork under `prefers-reduced-motion: reduce`.
This also works for server-rendered HTML map markers and responds to a changed system preference without a
React subscription. CSS cannot stop animation inside an external SMIL SVG. The checkpoint drawer and hover
popup always request static artwork. UI controls and severity shapes remain Tabler.

Mapping lives in `src/lib/weatherIcons.ts`. Unknown forecasts always use `not-available`; the deciding driver
selects wind/rain/snow/thunder, with stronger precipitation using extreme artwork. Clear-day/night is an ETA
local-clock cue (06:00–18:00), not an astronomical sunrise/sunset calculation and not additional forecast data.
