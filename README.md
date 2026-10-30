# Gefühlte Temperatur · Apparent Temperature

How warm does it actually feel outside, and should you open the windows?

- **Gefühlt / Feels like:** the UTCI felt temperature from air temperature, humidity, wind and sun, for now or any hour of a 16-day forecast. A consensus (median) of several weather models with their spread, night shading, and a per-day overview.
- **Lüften / Ventilate:** compares indoor and outdoor air (absolute humidity, dew point, enthalpy) and says whether airing helps right now, hour by hour for the next 24 h, and when the best window is.

German and English, following the device language. Works offline with the last loaded forecast. Runs as a PWA and as an Android app.

## Run

```sh
nvm use        # Node 22
npm ci
npm run dev
```

## Scripts

| Script                      | What it does                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `dev` / `build` / `preview` | Vite dev server, production build, serve the build                                                                      |
| `check`                     | `typecheck`, `lint`, `format:check` and `test` — run before every push                                                  |
| `test`                      | Unit tests (Vitest, `tests/`)                                                                                           |
| `e2e`                       | Playwright smoke test on desktop and phone, with mocked weather APIs and an offline reload. Needs `npm run build` first |
| `format`                    | Prettier                                                                                                                |
| `icons`                     | Rasterise `public/icon.svg` into the PWA and Android icons                                                              |
| `cap:sync`                  | Build and copy the web app into `android/`                                                                              |

## Deploy

- **Web:** merging to `main` runs `deploy.yml`: CI, then build and GitHub Pages. Only web-source changes trigger it.
- **Android:** `android.yml` builds the APK and AAB on every PR and on `main`, boots it on an emulator and fails on web errors. When the `package.json` version on `main` has no tag yet, it publishes a GitHub release `v<version>` with `apparent-temperature-<version>.apk`.

### Android install and verification

Install from the [releases](https://github.com/jibes/apparent-temperature/releases), for updates via [Obtainium](https://github.com/ImranR98/Obtainium) with this repository's URL. Verify the signer with AppVerifier:

```
Signing certificate SHA-256: (published with the first signed release)
```

## Privacy

No account, no tracking, no analytics. All settings and the forecast cache stay on the device (localStorage and IndexedDB). The app only contacts:

- **[Open-Meteo](https://open-meteo.com/)** (`api.open-meteo.com`) for the forecast, sending the coordinates of your location or of the place you searched.
- **[Nominatim / OpenStreetMap](https://nominatim.openstreetmap.org/)** (`nominatim.openstreetmap.org`) to turn coordinates into a place name and to search places.

Your position is only read when you allow location access, and is used for nothing but these two requests.

## Licence

[GPL-3.0-or-later](LICENSE).
