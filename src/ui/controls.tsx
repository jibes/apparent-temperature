import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';

// Slider. A native range input jumps to wherever a finger first lands and
// commits that on the tap — so an accidental tap, or a tap that turns into a
// vertical page scroll, would change the value. On TOUCH we therefore ignore
// changes until the finger has actually dragged sideways past a small
// threshold (and revert the tap-jump the browser applied to the DOM),
// capturing the pointer only once it's a real drag so vertical scrolling
// (touch-action: pan-y) still works. Mouse/keyboard keep their normal
// behaviour: desktop click-to-set and arrow keys commit immediately.
const SLIDER_DRAG_PX = 6;

interface SliderProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
}

export function Slider({ label, value, onChange, min, max, step, unit }: SliderProps) {
  const ref = useRef<HTMLInputElement>(null);
  const g = useRef({
    down: false,
    moved: false,
    startX: 0,
    startVal: value,
    touch: false,
    pid: -1,
  });

  function onDown(e: React.PointerEvent<HTMLInputElement>) {
    g.current = {
      down: true,
      moved: false,
      startX: e.clientX,
      startVal: value,
      touch: e.pointerType !== 'mouse',
      pid: e.pointerId,
    };
    // Mouse captures immediately (click-to-set/drag); touch waits until it's a
    // real horizontal drag so a vertical scroll gesture isn't hijacked.
    if (e.pointerType === 'mouse') e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onMove(e: React.PointerEvent<HTMLInputElement>) {
    const s = g.current;
    if (!s.down || s.moved) return;
    if (Math.abs(e.clientX - s.startX) > SLIDER_DRAG_PX) {
      s.moved = true;
      if (s.touch && ref.current) {
        try {
          ref.current.setPointerCapture(s.pid);
        } catch {
          /* pointer already gone */
        }
      }
    }
  }
  function onChangeEv(e: React.ChangeEvent<HTMLInputElement>) {
    const s = g.current;
    // Touch, finger down but not yet a real drag → this is the tap-jump (or a
    // scroll start): swallow it and undo the DOM change the browser made.
    if (s.touch && s.down && !s.moved) {
      e.target.value = String(s.startVal);
      return;
    }
    onChange(Number(e.target.value));
  }
  function onUp() {
    g.current.down = false;
  }

  return (
    <div className="control">
      <div className="control-header">
        <span className="slider-label">{label}</span>
        <span className="value-badge">
          {value} {unit}
        </span>
      </div>
      <input
        ref={ref}
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChangeEv}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onLostPointerCapture={onUp}
        style={{ touchAction: 'pan-y' }}
      />
    </div>
  );
}

// Info tooltip
export function Info({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [dx, setDx] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  // Close on any tap/click outside — an open tooltip otherwise stays until
  // its own "i" is hit again, unlike every other transient UI element.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  // The tip is centered on its trigger; near a screen edge that would clip
  // it (the info icons in the table sit close to the left edge on phones).
  // Measure once per open — before paint, so no visible jump — and shift it
  // just enough to stay fully inside the viewport.
  useLayoutEffect(() => {
    if (!open || !tipRef.current) return;
    const pad = 10;
    const r = tipRef.current.getBoundingClientRect();
    if (r.left < pad) setDx(pad - r.left);
    else if (r.right > window.innerWidth - pad) setDx(window.innerWidth - pad - r.right);
  }, [open]);
  return (
    <span className="info-wrap" ref={ref}>
      <button
        type="button"
        className="info-btn"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setDx(0);
          setOpen((o) => !o);
        }}
        aria-label={t.info}
        aria-expanded={open}
      >
        i
      </button>
      {open && (
        <span
          className="info-tip"
          ref={tipRef}
          style={{ transform: `translateX(calc(-50% + ${dx}px))` }}
        >
          {children}
        </span>
      )}
    </span>
  );
}

// Value chips in collapsible summary
export function Chip({ children, cls }: { children: ReactNode; cls?: string }) {
  return <span className={`chip ${cls ?? ''}`}>{children}</span>;
}
