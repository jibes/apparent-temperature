import type { BrowserContext } from '@playwright/test';

const MODELS = ['icon_seamless', 'gfs_seamless', 'ecmwf_ifs025'];

// Open-Meteo-shaped responses (per-model suffixed keys), UTC wall clock, so
// the app runs fully offline from the real services.
function hourly() {
  const start = Math.floor(Date.now() / 3600000) * 3600000 - 24 * 3600000;
  const n = 24 * 17;
  const time = Array.from({ length: n }, (_, i) =>
    new Date(start + i * 3600000).toISOString().slice(0, 16),
  );
  const out: Record<string, unknown> = { time };
  MODELS.forEach((m, k) => {
    const day = (i: number) => Math.sin(((i % 24) - 9) * (Math.PI / 12));
    out[`temperature_2m_${m}`] = time.map((_, i) => 14 + 6 * day(i) + k * 0.4);
    out[`relative_humidity_2m_${m}`] = time.map((_, i) => 65 - 15 * day(i));
    out[`wind_speed_10m_${m}`] = time.map(() => 10 + k);
    out[`cloud_cover_${m}`] = time.map(() => 40);
    out[`shortwave_radiation_instant_${m}`] = time.map((_, i) => Math.max(0, 500 * day(i)));
  });
  return { latitude: 52.52, longitude: 13.41, elevation: 38, utc_offset_seconds: 0, hourly: out };
}

function current() {
  const c: Record<string, number> = {};
  MODELS.forEach((m, k) => {
    c[`temperature_2m_${m}`] = 18 + k * 0.4;
    c[`relative_humidity_2m_${m}`] = 60;
    c[`wind_speed_10m_${m}`] = 10;
    c[`cloud_cover_${m}`] = 40;
  });
  return { latitude: 52.52, longitude: 13.41, elevation: 38, timezone: 'GMT', current: c };
}

export async function mockServices(context: BrowserContext) {
  await context.route('https://api.open-meteo.com/**', (route) =>
    route.fulfill({
      json: route.request().url().includes('hourly=') ? hourly() : current(),
    }),
  );
  await context.route('https://nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({
      json: route.request().url().includes('/search')
        ? [{ lat: '48.137', lon: '11.575', address: { city: 'München' } }]
        : { address: { city: 'Teststadt' } },
    }),
  );
}
