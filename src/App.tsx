import { useEffect, useRef, useState } from 'react';
import { distKm, nowReading } from './core/time';
import {
  fetchCurrentWeather,
  fetchHourlyForecast,
  reverseGeocode,
  searchLocation,
  type CurrentWeather,
  type Hour,
  type Place,
} from './core/weather';
import { lang, t } from './i18n';
import { dropObsoletePrefs, hasPref, loadWxCache, saveWxCache, type WxMeta } from './storage';
import { FeltTab } from './ui/FeltTab';
import { GeoBar, type GeoStatus, type LocSource } from './ui/GeoBar';
import { LueftenTab } from './ui/LueftenTab';
import { UpdateBanner } from './ui/UpdateBanner';
import { agoLabel } from './ui/format';
import { usePersistentState } from './ui/usePersistentState';

type Tab = 'felt' | 'lueften';
const REFRESH_MS = 5 * 60000;

export default function App() {
  const [tab, setTab] = usePersistentState<Tab>('tab', 'felt');

  const [outTemp, setOutTemp] = usePersistentState('outTemp', 28);
  const [outRH, setOutRH] = usePersistentState('outRH', 65);
  const [inTemp, setInTemp] = usePersistentState('inTemp', 24);
  const [inRH, setInRH] = usePersistentState('inRH', 55);

  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle');
  const [geoLocation, setGeoLocation] = usePersistentState<Place | null>('geoLocation', null);
  const [locSource, setLocSource] = usePersistentState<LocSource>('locSource', 'gps');
  const [hours, setHours] = useState<Hour[] | null>(null);
  // Graph selection, lifted so both tabs share it. Anchored to the selected
  // hour's timestamp (not its index) — hours is a sliding window. null = now.
  const [selTs, setSelTs] = useState<number | null>(null);
  const [wxMeta, setWxMeta] = useState<WxMeta | null>(null);
  const [gridPlace, setGridPlace] = useState<string | null>(null); // reverse-geocoded wxMeta.grid
  const [updatedAt, setUpdatedAt] = useState<number | null>(null); // ms of last successful fetch
  const [, setNowTick] = useState(0); // keeps the freshness label ticking

  // Cold start (offline, flaky network): hydrate from the last successful
  // weather and show stale-but-labelled data instead of an empty placeholder.
  // Never overwrites data a fetch already delivered.
  useEffect(() => {
    let cancelled = false;
    void loadWxCache().then((c) => {
      if (cancelled || !c) return;
      setHours((h) => h ?? c.hours);
      setWxMeta((m) => m ?? c.wxMeta);
      setUpdatedAt((u) => u ?? c.updatedAt);
    });
    dropObsoletePrefs();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the cache current (hours dominates the payload; meta rides along).
  useEffect(() => {
    if (hours) void saveWxCache({ hours, wxMeta, updatedAt });
  }, [hours, wxMeta, updatedAt]);

  // Prefill guard: only a genuinely FIRST visit (no saved indoor temp) gets
  // it seeded from the outdoor reading.
  const prefilledRef = useRef(hasPref('inTemp'));
  // The `current` endpoint only feeds methodology metadata (member count,
  // spread, grid cell); the outdoor values everywhere come from the hourly
  // forecast's "now" bucket, so there is exactly one definition of "now".
  function applyWeather(w: CurrentWeather) {
    if (w.sources) setWxMeta({ sources: w.sources, spread: w.spread, grid: w.grid });
    setUpdatedAt(Date.now());
  }

  // Reverse-geocode the grid cell (not the query point) so the methodology
  // can name the place the sharpest model describes.
  const gridLat = wxMeta?.grid?.lat;
  const gridLon = wxMeta?.grid?.lon;
  useEffect(() => {
    if (gridLat == null || gridLon == null) return;
    let cancelled = false;
    reverseGeocode(gridLat, gridLon, lang)
      .then((name) => {
        if (!cancelled) setGridPlace(name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gridLat, gridLon]);

  // Sync the outdoor values from the interpolated "now" reading whenever a
  // fresh forecast arrives; prefill indoor temp once (first visit ever).
  useEffect(() => {
    const nv = nowReading(hours);
    if (!nv) return;
    setOutTemp(Math.round(nv.temp * 2) / 2);
    setOutRH(Math.round(nv.humidity));
    if (!prefilledRef.current) {
      setInTemp(Math.round(nv.temp * 2) / 2);
      prefilledRef.current = true;
    }
  }, [hours, setOutTemp, setOutRH, setInTemp]);

  const loadHourly = (la: number, lo: number) =>
    // A failed hourly fetch must not go silent: the place name would update
    // while the graph kept showing the previous place's forecast.
    fetchHourlyForecast(la, lo)
      .then(setHours)
      .catch(() => setGeoStatus('error'));

  // `silent` = background re-acquire: no status flicker, and a failure keeps
  // what's on screen. `skipIfNear` (mount-time catch-up only): skip when the
  // device hasn't moved > 2 km from the saved place, whose refetch is
  // already in flight.
  function loadWeather(silent = false, skipIfNear = false) {
    if (!navigator.geolocation) {
      if (!silent) setGeoStatus('denied');
      return;
    }
    if (!silent) setGeoStatus('loading');
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        if (
          skipIfNear &&
          geoLocation?.lat != null &&
          distKm(coords.latitude, coords.longitude, geoLocation.lat, geoLocation.lon) < 2
        ) {
          setLocSource('gps');
          return;
        }
        if (!silent) setGeoStatus('locating');
        try {
          applyWeather(await fetchCurrentWeather(coords.latitude, coords.longitude));
          void loadHourly(coords.latitude, coords.longitude);
          const name = await reverseGeocode(coords.latitude, coords.longitude, lang).catch(
            () => null,
          );
          setGeoLocation({ lat: coords.latitude, lon: coords.longitude, name });
          setLocSource('gps');
          setGeoStatus('ok');
        } catch {
          if (!silent) setGeoStatus('error');
        }
      },
      () => {
        if (!silent) setGeoStatus('denied');
      },
    );
  }

  // Refetch weather for a known location (no geolocation prompt).
  async function refetchFor(place: Place, silent = false) {
    if (!silent) setGeoStatus('locating');
    try {
      applyWeather(await fetchCurrentWeather(place.lat, place.lon));
      void loadHourly(place.lat, place.lon);
      setGeoLocation(place);
      setGeoStatus('ok');
    } catch {
      if (!silent) setGeoStatus('error');
    }
  }

  async function searchWeather(query: string) {
    setGeoStatus('searching');
    try {
      const loc = await searchLocation(query, lang);
      if (!loc) {
        setGeoStatus('notfound');
        return;
      }
      applyWeather(await fetchCurrentWeather(loc.lat, loc.lon));
      void loadHourly(loc.lat, loc.lon);
      setGeoLocation(loc);
      setLocSource('search');
      setGeoStatus('ok');
    } catch {
      setGeoStatus('error');
    }
  }

  // GPS mode re-acquires the device position (follows the user); a searched
  // place is only refetched — never switched back to GPS uninvited.
  function refresh(silent = false) {
    if (locSource === 'search' && geoLocation?.lat != null) void refetchFor(geoLocation, silent);
    else loadWeather(silent);
  }
  // The effects below need the latest closure without re-arming timers on
  // every render.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  // Errors self-heal: while the last fetch failed, retry silently every 30 s.
  // retryTick re-arms the timer after each unsuccessful attempt.
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    if (geoStatus !== 'error') return;
    const id = setTimeout(() => {
      refreshRef.current(true);
      setRetryTick((n) => n + 1);
    }, 30000);
    return () => clearTimeout(id);
  }, [geoStatus, retryTick]);

  // On mount: refresh a saved location immediately; in GPS mode ALSO
  // silently re-acquire the device position ("where I am", not "where I was").
  useEffect(() => {
    if (geoLocation && geoLocation.lat != null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
      void refetchFor(geoLocation);
      if (locSource !== 'search') loadWeather(true, true);
    } else {
      loadWeather();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  // Freshness label tick; auto-refresh every 5 min while visible, and right
  // away when the app is reactivated (visibilitychange OR window focus) with
  // stale data.
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 60000);
    const refreshId = setInterval(() => {
      if (document.visibilityState === 'visible') refreshRef.current(true);
    }, REFRESH_MS);
    function refreshIfStale() {
      if (
        document.visibilityState === 'visible' &&
        updatedAt &&
        Date.now() - updatedAt > REFRESH_MS
      ) {
        refreshRef.current(true);
      }
    }
    document.addEventListener('visibilitychange', refreshIfStale);
    window.addEventListener('focus', refreshIfStale);
    return () => {
      clearInterval(id);
      clearInterval(refreshId);
      document.removeEventListener('visibilitychange', refreshIfStale);
      window.removeEventListener('focus', refreshIfStale);
    };
  }, [updatedAt]);

  return (
    <div className="app">
      <UpdateBanner />
      {/* The tabs are the heading, with the (global) location right below. */}
      <div className="top-bar">
        <nav className="tabs">
          <button
            type="button"
            className={`tab ${tab === 'felt' ? 'active' : ''}`}
            aria-pressed={tab === 'felt'}
            onClick={() => setTab('felt')}
          >
            {t.tabs.felt}
          </button>
          <button
            type="button"
            className={`tab ${tab === 'lueften' ? 'active' : ''}`}
            aria-pressed={tab === 'lueften'}
            onClick={() => setTab('lueften')}
          >
            {t.tabs.vent}
          </button>
        </nav>
        <GeoBar
          status={geoStatus}
          location={geoLocation}
          freshness={updatedAt ? agoLabel(updatedAt) : null}
          locSource={locSource}
          onSearch={(q) => void searchWeather(q)}
          onLocate={() => loadWeather(false)}
        />
      </div>

      {/* Both tabs stay mounted (inactive one hidden) so selection, toggles
          and scroll position survive switching back and forth. */}
      <main>
        <div style={{ display: tab === 'felt' ? undefined : 'none' }}>
          <FeltTab
            hours={hours}
            wxMeta={geoStatus === 'ok' ? wxMeta : null}
            gridPlace={geoStatus === 'ok' ? gridPlace : null}
            lat={geoLocation?.lat ?? 50}
            lon={geoLocation?.lon ?? 10}
            selTs={selTs}
            setSelTs={setSelTs}
            visible={tab === 'felt'}
          />
        </div>
        <div style={{ display: tab === 'lueften' ? undefined : 'none' }}>
          <LueftenTab
            inTemp={inTemp}
            setInTemp={setInTemp}
            inRH={inRH}
            setInRH={setInRH}
            outTemp={outTemp}
            outRH={outRH}
            hours={hours}
            elevation={wxMeta?.grid?.elevation ?? 0}
          />
        </div>
      </main>
      <footer className="build-info">{t.build(__BUILD__.sha, __BUILD__.time.slice(0, 10))}</footer>
    </div>
  );
}
