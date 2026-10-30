import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Place } from '../core/weather';
import { t } from '../i18n';

export type GeoStatus =
  'idle' | 'loading' | 'locating' | 'ok' | 'searching' | 'notfound' | 'error' | 'denied';
export type LocSource = 'gps' | 'search';

interface Props {
  status: GeoStatus;
  location: Place | null;
  freshness: string | null;
  locSource: LocSource;
  onSearch: (q: string) => void;
  onLocate: () => void;
}

// Location bar. The chip itself is the tap target for changing the place
// (opens the search row — one obvious affordance instead of a bare 🔍 icon
// off to the side). A mode glyph distinguishes "follows your position" (🧭,
// GPS re-acquired on every refresh) from a pinned searched place (📍).
// The search row has explicit submit / cancel and a labeled way back to the
// device position; Escape cancels too. No manual refresh button: data
// refreshes itself (5-min interval, focus/visibility catch-up, GPS follow,
// and a 30-s silent retry loop after errors) — a button couldn't get
// anything fresher.
export function GeoBar({ status, location, freshness, locSource, onSearch, onLocate }: Props) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searching) inputRef.current?.focus();
  }, [searching]);

  function close() {
    setSearching(false);
    setQuery('');
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    onSearch(q);
    close();
  }

  if (searching) {
    return (
      <form className="geo-bar" onSubmit={submit}>
        <button
          type="button"
          className="geo-icon"
          onClick={() => {
            close();
            onLocate();
          }}
          title={t.geo.useMyLocation}
          aria-label={t.geo.useMyLocation}
        >
          🧭
        </button>
        <input
          ref={inputRef}
          className="geo-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
          }}
          placeholder={t.geo.searchPlaceholder}
          aria-label={t.geo.searchPlaceholder}
          enterKeyHint="search"
        />
        <button type="submit" className="geo-icon" title={t.geo.search} aria-label={t.geo.search}>
          🔍
        </button>
        <button
          type="button"
          className="geo-icon"
          onClick={close}
          title={t.geo.cancel}
          aria-label={t.geo.cancel}
        >
          ✕
        </button>
      </form>
    );
  }

  // Chip content + tone per status; freshness folds into the chip instead
  // of its own row.
  const modeGlyph = locSource === 'search' ? '📍' : '🧭';
  const modeTitle = locSource === 'search' ? t.geo.pinnedTitle : t.geo.followTitle;
  let cls: string;
  let content: ReactNode;
  if (status === 'loading') {
    // 'loading' = acquiring the device position; 'locating' = fetching
    // weather for already-known coordinates.
    [cls, content] = ['geo-msg loading', t.geo.locating];
  } else if (status === 'locating') {
    [cls, content] = ['geo-msg loading', t.geo.updating];
  } else if (status === 'ok' && location) {
    cls = 'geo-ok';
    content = (
      <>
        {modeGlyph} {location.name ?? `${location.lat.toFixed(2)}, ${location.lon.toFixed(2)}`}
        {freshness && <em> · {freshness}</em>}
      </>
    );
  } else if (status === 'searching') {
    [cls, content] = ['geo-msg loading', t.geo.searching];
  } else if (status === 'notfound') {
    [cls, content] = ['geo-msg warn', t.geo.notFound];
  } else if (status === 'error' && freshness) {
    cls = 'geo-msg warn';
    content = (
      <>
        {t.geo.failed} <em>· {freshness}</em>
      </>
    );
  } else {
    [cls, content] = ['geo-msg warn', t.geo.choose];
  }

  return (
    <div className="geo-bar">
      <span className="geo-status">
        <button
          type="button"
          className={`geo-chip ${cls}`}
          onClick={() => setSearching(true)}
          title={status === 'ok' ? modeTitle : t.geo.searchTitle}
        >
          <span className="geo-chip-text">{content}</span>
          <span className="geo-chip-find" aria-hidden="true">
            🔍
          </span>
        </button>
      </span>
    </div>
  );
}
