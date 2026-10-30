# Gefühlte Temperatur (apparent-temperature): agent notes

Follows the portfolio standard: https://github.com/jibes/apps-data/blob/main/STANDARD.md
List deviations from it here, each with a reason.

## Stack

- TypeScript strict, React 19, Vite, vite-plugin-pwa, Vitest, Playwright. Node: see `.nvmrc`.
- Capacitor 8 Android shell in `android/` (web build bundled via `cap sync`).
- Check library APIs against the installed types in `node_modules`, not from memory.

## Architecture

- `src/core/` is pure logic with no DOM, and every module has tests in `tests/`:
  `formulas` (psychrometrics, UTCI, sun), `weather` (Open-Meteo / Nominatim clients),
  `time` (the single definition of "now"), `series` (chart metrics and scales), `vent` (ventilation verdict).
- `src/ui/` holds components and may import from `core/`, never the other way round.
  Core returns keys and numbers; the UI turns them into text through `src/i18n`.
- `src/storage.ts` owns every persisted key; `src/native.ts` owns the `isNative` flag.
- Keep each file under 800 lines; split before adding to it.

## Invariants

- Storage keys follow `apparent-temperature.<name>.v<N>`. Never rename an existing key: bump the version and migrate.
  Pre-standard bare keys (`inTemp`, `wxCache`, …) are migrated on first read in `storage.ts`.
- "Now" has exactly one definition: `core/time.ts` (`nowHourIndex`/`nowReading`). Headline, chart and Lüften tab all read it.
- Chart selections are anchored to an hour's timestamp, never its array index (the window slides with every refetch).
- Nothing on screen may jump: placeholders reserve the loaded height, and optional lines keep a spacer.
- User data never leaves the device unless the user acts. Network calls go only to the services listed in README → Privacy (also the CSP `connect-src` in `vite.config.ts`).
- No user-facing string is hard-coded. Add it to `src/i18n/en.ts` and to `de.ts` (`tests/i18n.test.ts` checks parity).

## Android

- Version: `package.json` `version` only. `android/app/build.gradle` derives versionName and versionCode (`major·10⁷ + minor·10⁵ + patch·10³`).
- Release: bump the version in a PR; after merge, `android.yml` builds, smoke-tests on an emulator and publishes `v<version>` if that tag doesn't exist yet. Without the signing secrets it builds with the debug key and does not release.
- Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Repository variable `ANDROID_CERT_SHA256` makes the signer check strict.
- Icons: edit `public/icon.svg`, then `npm run icons` (writes the PWA PNGs and the Android mipmaps).
- Never commit `android/app/src/main/assets/public` (copied web build, gitignored).

## Deviations

- **react-hooks v7 rules:** three single-line disables, each with its reason: the mount-time fetch (`set-state-in-effect`), expiring a stale selection / isolation (`set-state-in-effect`), and the 24-h strip reading the wall clock (`purity`). Time is an input of this app; making every render clock-free would mean threading a `now` prop through every component for no behavioural gain.
- **CSP `style-src 'unsafe-inline'`:** React `style` attributes (chart colours, CSS variables) need it. Scripts stay `'self'` only.
- **No `src/workers/`:** nothing is heavy enough; the biggest computation (series for ~390 hours) is memoized.
- **Dev build versions:** non-release APKs carry the plain `package.json` version, not "last tag + commits". Every APK is built in CI, and release builds are tag-gated, so the two can't be confused.
- **UI language follows the device** (German or English); there is no in-app switch.
- **Deploy path filter excludes `package*.json`:** per the standard a version bump must not redeploy the web; a dependency-only update therefore deploys with the next web change or a manual run of `deploy.yml`.

## Done checklist (before every push)

1. `npm run check` (typecheck, lint, format:check, unit)
2. `npm run build && npm run e2e`
3. If you fixed a bug, a test now covers it.
4. README is updated if you changed behaviour, scripts or services.
