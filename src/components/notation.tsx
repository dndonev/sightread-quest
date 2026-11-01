import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { Accidental, Pitch } from '../music-theory/pitch';
import type { Clef } from '../notation/staff';
import { type ScoreLayout, type SimpleNote, renderChordSequence, renderScore, renderSimple } from '../notation/render';
import type { Exercise } from '../game-engine/sightReading';
import { cx } from './ui';

export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.floor(el.clientWidth));
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Re-render notation once the embedded Bravura font has loaded. */
let fontsReady = false;
const fontWaiters = new Set<() => void>();
if (typeof document !== 'undefined' && document.fonts) {
  Promise.all([document.fonts.load('30px Bravura'), document.fonts.ready])
    .catch(() => {})
    .finally(() => {
      fontsReady = true;
      fontWaiters.forEach((f) => f());
    });
}
export function useFontsReady() {
  const [ready, setReady] = useState(fontsReady);
  useEffect(() => {
    if (ready) return;
    const f = () => setReady(true);
    fontWaiters.add(f);
    return () => void fontWaiters.delete(f);
  }, [ready]);
  return ready;
}

export function NoteStaff({
  notes,
  clef,
  keyFifths = 0,
  guitar8vb,
  height = 160,
  className,
  grand,
  maxWidth = 520,
  label,
}: {
  notes: SimpleNote[];
  clef: Clef;
  keyFifths?: number;
  guitar8vb?: boolean;
  height?: number;
  className?: string;
  grand?: boolean;
  maxWidth?: number;
  label: string;
}) {
  const [wrap, width] = useElementWidth<HTMLDivElement>();
  const target = useRef<HTMLDivElement>(null);
  const fonts = useFontsReady();
  const sig = JSON.stringify({ notes, clef, keyFifths, guitar8vb, grand, height });
  useEffect(() => {
    if (!target.current || width < 50) return;
    try {
      renderSimple(target.current, notes, { clef, keyFifths, guitar8vb, width: Math.min(width, maxWidth), height, grand });
    } catch (e) {
      console.error('render failed', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, width, fonts]);
  return (
    <div ref={wrap} className={cx('notation w-full', className)} role="img" aria-label={label}>
      <div ref={target} />
    </div>
  );
}

export function ChordSequence({ chords, clef, keyFifths, guitar8vb, label }: { chords: Pitch[][]; clef: Clef; keyFifths: number; guitar8vb?: boolean; label: string }) {
  const [wrap, width] = useElementWidth<HTMLDivElement>();
  const target = useRef<HTMLDivElement>(null);
  const fonts = useFontsReady();
  const sig = JSON.stringify({ chords, clef, keyFifths, guitar8vb });
  useEffect(() => {
    if (!target.current || width < 50) return;
    renderChordSequence(target.current, chords, { clef, keyFifths, guitar8vb, width: Math.min(width, 720) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, width, fonts]);
  return (
    <div ref={wrap} className="notation w-full" role="img" aria-label={label}>
      <div ref={target} />
    </div>
  );
}

export interface ScoreViewHandle {
  /** Position overlays for a tick (call every animation frame while playing). */
  update: (tick: number, opts?: { highlightId?: number | null; mask?: boolean; lookAhead?: boolean }) => void;
}

export const ScoreView = forwardRef<ScoreViewHandle, { exercise: Exercise; guitar8vb: boolean; showTab: boolean; colors?: Map<number, string>; dimPast?: boolean }>(
  function ScoreView({ exercise, guitar8vb, showTab, colors }, ref) {
    const [wrap, width] = useElementWidth<HTMLDivElement>();
    const target = useRef<HTMLDivElement>(null);
    const playhead = useRef<HTMLDivElement>(null);
    const highlight = useRef<HTMLDivElement>(null);
    const mask = useRef<HTMLDivElement>(null);
    const ahead = useRef<HTMLDivElement>(null);
    const layoutRef = useRef<ScoreLayout | null>(null);
    const lastLine = useRef(-1);
    const fonts = useFontsReady();

    useEffect(() => {
      if (!target.current || width < 50) return;
      try {
        layoutRef.current = renderScore(target.current, exercise, { width, guitar8vb, showTab, colors });
      } catch (e) {
        console.error('score render failed', e);
      }
      lastLine.current = -1;
    }, [exercise, width, guitar8vb, showTab, colors, fonts]);

    useImperativeHandle(ref, () => ({
      update(tick, opts = {}) {
        const L = layoutRef.current;
        const ph = playhead.current;
        if (!L || !ph) return;
        const ex = exercise;
        const hide = (el: HTMLDivElement | null) => el && (el.style.opacity = '0');
        if (tick < 0 || tick > ex.totalTicks) {
          ph.style.opacity = tick < 0 && tick > -1e6 ? '0.35' : '0';
          const first = L.measures[0];
          const line = L.lines[0];
          if (tick < 0 && first && line) {
            ph.style.transform = `translate(${first.noteStart}px, ${line.staffTop - 14}px)`;
            ph.style.height = `${line.staffBottom - line.staffTop + 28}px`;
          }
          hide(highlight.current);
          hide(mask.current);
          hide(ahead.current);
          return;
        }
        const evIdx = ex.events.findIndex((e) => tick >= e.start && tick < e.start + e.ticks);
        const ev = ex.events[Math.max(0, evIdx)];
        const pos = L.events.get(ev.id);
        if (!pos) return;
        const mInfo = L.measures[ev.measure];
        const next = ex.events[ex.events.indexOf(ev) + 1];
        const nextPos = next ? L.events.get(next.id) : undefined;
        const endX = nextPos && nextPos.line === pos.line && next.measure === ev.measure ? nextPos.x : mInfo.x1 - 8;
        const frac = Math.min(1, Math.max(0, (tick - ev.start) / ev.ticks));
        const x = pos.x + (endX - pos.x) * frac;
        const line = L.lines[pos.line];
        ph.style.opacity = '1';
        ph.style.transform = `translate(${x}px, ${line.staffTop - 14}px)`;
        ph.style.height = `${line.staffBottom - line.staffTop + 28}px`;
        if (pos.line !== lastLine.current) {
          lastLine.current = pos.line;
          const host = wrap.current;
          const scroller = host?.closest('[data-score-scroll]') as HTMLElement | null;
          if (scroller) scroller.scrollTo({ top: Math.max(0, line.top - 8), behavior: 'smooth' });
        }
        const hl = highlight.current;
        if (hl) {
          const hev = opts.highlightId !== undefined && opts.highlightId !== null ? ex.events.find((e) => e.id === opts.highlightId) : null;
          const hp = hev ? L.events.get(hev.id) : null;
          if (hp) {
            const hl2 = L.lines[hp.line];
            hl.style.opacity = '1';
            hl.style.transform = `translate(${hp.x - 12}px, ${hl2.staffTop - 30}px)`;
            hl.style.height = `${hl2.staffBottom - hl2.staffTop + 60}px`;
          } else hl.style.opacity = '0';
        }
        // Read-ahead: mask the current beat and tint the next bar.
        const mk = mask.current;
        if (mk) {
          if (opts.mask) {
            mk.style.opacity = '1';
            const x0 = Math.min(pos.x - 14, x - 14);
            mk.style.transform = `translate(${x0}px, ${line.staffTop - 34}px)`;
            mk.style.width = `${Math.max(36, endX - x0 + 4)}px`;
            mk.style.height = `${line.staffBottom - line.staffTop + 68}px`;
          } else mk.style.opacity = '0';
        }
        const ah = ahead.current;
        if (ah) {
          const nm = L.measures[ev.measure + 1];
          if (opts.lookAhead && nm) {
            const nl = L.lines[nm.line];
            ah.style.opacity = '1';
            ah.style.transform = `translate(${nm.x0}px, ${nl.staffTop - 26}px)`;
            ah.style.width = `${nm.x1 - nm.x0}px`;
            ah.style.height = `${nl.staffBottom - nl.staffTop + 52}px`;
          } else ah.style.opacity = '0';
        }
      },
    }));

    return (
      <div ref={wrap} className="notation relative w-full" role="img" aria-label={`Score: ${exercise.title}`}>
        <div ref={target} />
        <div ref={ahead} className="pointer-events-none absolute left-0 top-0 rounded-xl bg-accent-2/10 ring-1 ring-accent-2/40 opacity-0 transition-opacity" />
        <div ref={highlight} className="pointer-events-none absolute left-0 top-0 w-[30px] rounded-lg bg-accent/15 ring-1 ring-accent/60 opacity-0" />
        <div ref={mask} className="pointer-events-none absolute left-0 top-0 rounded-lg bg-panel opacity-0" />
        <div ref={playhead} className="pointer-events-none absolute left-0 top-0 w-[3px] rounded-full bg-accent shadow-[0_0_12px_rgba(45,212,191,0.8)] opacity-0" />
      </div>
    );
  },
);

export type { SimpleNote, Accidental };
