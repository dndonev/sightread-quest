import { useEffect, useRef, useState } from 'react';
import { type Accidental, type Letter, type NoteNaming, SOLFEGE, fromMidi, displayName } from '../music-theory/pitch';
import { type Fingering, type FretPosition, STANDARD_TUNING_MIDI, MAX_FRET, midiAt, stringNumber } from '../music-theory/guitar';
import { cx } from './ui';

const INLAYS = [3, 5, 7, 9, 15];

/** Interactive fretboard (frets 0–15). Emits SOUNDING MIDI. Scrolls horizontally inside its own box. */
export function Fretboard({
  onPress,
  onRelease,
  highlights = [],
  marks = [],
  disabled,
  labels,
}: {
  onPress?: (midi: number, pos: FretPosition) => void;
  onRelease?: (midi: number, pos: FretPosition) => void;
  highlights?: FretPosition[];
  marks?: FretPosition[];
  disabled?: boolean;
  labels?: boolean;
}) {
  const fretW = 54;
  const stringH = 40;
  const nutW = 46;
  const width = nutW + MAX_FRET * fretW + 10;
  const height = stringH * 6 + 20;
  const [pressed, setPressed] = useState<string | null>(null);
  const isHi = (s: number, f: number, list: FretPosition[]) => list.some((p) => p.string === s && p.fret === f);
  const fretX = (f: number) => (f === 0 ? nutW / 2 : nutW + (f - 0.5) * fretW);
  const strY = (s: number) => 14 + (5 - s) * stringH + stringH / 2 - 4;

  return (
    <div className="no-scrollbar -mx-4 overflow-x-auto px-4" aria-label="Guitar fretboard">
      <svg width={width} height={height} className="touch-none select-none" style={{ minWidth: width }}>
        <rect x={nutW} y={10} width={MAX_FRET * fretW} height={stringH * 6 - 4} rx={6} fill="#1a2440" />
        {INLAYS.map((f) => (
          <circle key={f} cx={nutW + (f - 0.5) * fretW} cy={10 + (stringH * 6 - 4) / 2} r={6} fill="#2a3a60" />
        ))}
        <circle cx={nutW + 11.5 * fretW} cy={10 + stringH * 1.5} r={6} fill="#2a3a60" />
        <circle cx={nutW + 11.5 * fretW} cy={10 + stringH * 4.5 - 4} r={6} fill="#2a3a60" />
        <rect x={nutW - 4} y={10} width={5} height={stringH * 6 - 4} fill="#cbd5e1" />
        {Array.from({ length: MAX_FRET }, (_, i) => (
          <line key={i} x1={nutW + (i + 1) * fretW} x2={nutW + (i + 1) * fretW} y1={10} y2={10 + stringH * 6 - 4} stroke="#475569" strokeWidth={2} />
        ))}
        {Array.from({ length: MAX_FRET + 1 }, (_, f) => (
          <text key={f} x={fretX(f)} y={height - 1} textAnchor="middle" fontSize={10} fill="#64748b">
            {f}
          </text>
        ))}
        {STANDARD_TUNING_MIDI.map((_, s) => (
          <line key={s} x1={4} x2={width - 6} y1={strY(s)} y2={strY(s)} stroke="#cbd5e1" strokeWidth={1 + (5 - s) * 0.35} opacity={0.85} />
        ))}
        {STANDARD_TUNING_MIDI.map((open, s) =>
          Array.from({ length: MAX_FRET + 1 }, (_, f) => {
            const id = `${s}-${f}`;
            const hi = isHi(s, f, highlights);
            const mk = isHi(s, f, marks);
            const m = open + f;
            return (
              <g
                key={id}
                role="button"
                aria-label={`String ${stringNumber(s)} fret ${f}`}
                onPointerDown={(e) => {
                  if (disabled) return;
                  e.preventDefault();
                  setPressed(id);
                  onPress?.(m, { string: s, fret: f });
                }}
                onPointerUp={() => {
                  if (pressed === id) onRelease?.(m, { string: s, fret: f });
                  setPressed(null);
                }}
                onPointerLeave={() => {
                  if (pressed === id) onRelease?.(m, { string: s, fret: f });
                  if (pressed === id) setPressed(null);
                }}
                style={{ cursor: disabled ? 'default' : 'pointer' }}
              >
                <rect x={f === 0 ? 0 : nutW + (f - 1) * fretW} y={strY(s) - stringH / 2} width={f === 0 ? nutW - 4 : fretW} height={stringH} fill="transparent" />
                {(hi || mk || pressed === id) && (
                  <circle cx={fretX(f)} cy={strY(s)} r={13} fill={pressed === id ? '#38bdf8' : hi ? '#2dd4bf' : 'rgba(251,191,36,0.85)'} />
                )}
                {labels && (hi || mk) && (
                  <text x={fretX(f)} y={strY(s) + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#0b1220">
                    {displayName(fromMidi(m))}
                  </text>
                )}
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}

/** Small vertical chord diagram. */
export function FretDiagram({ fingering, size = 1 }: { fingering: Fingering; size?: number }) {
  const frets = 5;
  const base = fingering.baseFret <= 1 ? 1 : fingering.baseFret;
  const w = 92 * size;
  const h = 112 * size;
  const left = 14 * size;
  const top = 18 * size;
  const sw = (w - left * 2) / 5;
  const fh = (h - top - 8 * size) / frets;
  const used = new Map(fingering.positions.map((p) => [p.string, p.fret]));
  return (
    <svg width={w} height={h} aria-label={`Chord diagram: ${fingering.positions.map((p) => `string ${stringNumber(p.string)} fret ${p.fret}`).join(', ')}`}>
      {base === 1 ? <rect x={left} y={top - 3} width={sw * 5} height={4} fill="#e2e8f0" /> : <text x={2} y={top + fh * 0.7} fontSize={10 * size} fill="#94a3b8">{base}</text>}
      {Array.from({ length: 6 }, (_, s) => (
        <line key={s} x1={left + s * sw} x2={left + s * sw} y1={top} y2={top + fh * frets} stroke="#94a3b8" strokeWidth={1} />
      ))}
      {Array.from({ length: frets + 1 }, (_, f) => (
        <line key={f} x1={left} x2={left + 5 * sw} y1={top + f * fh} y2={top + f * fh} stroke="#64748b" strokeWidth={1} />
      ))}
      {Array.from({ length: 6 }, (_, s) => {
        const f = used.get(s);
        const x = left + s * sw;
        if (f === undefined) return <text key={s} x={x} y={top - 6} textAnchor="middle" fontSize={10 * size} fill="#64748b">×</text>;
        if (f === 0) return <circle key={s} cx={x} cy={top - 9} r={3.5 * size} fill="none" stroke="#e2e8f0" strokeWidth={1.4} />;
        const row = f - base + 0.5;
        return <circle key={s} cx={x} cy={top + row * fh} r={6 * size} fill="#2dd4bf" />;
      })}
    </svg>
  );
}

/** Piano keyboard emitting SOUNDING MIDI. Scrolls inside its own box. */
export function Piano({ low = 48, high = 84, onPress, onRelease, highlights = [], disabled }: { low?: number; high?: number; onPress?: (m: number) => void; onRelease?: (m: number) => void; highlights?: number[]; disabled?: boolean }) {
  const whiteW = 44;
  const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
  const whites: number[] = [];
  for (let m = low; m <= high; m++) if (!isBlack(m)) whites.push(m);
  const width = whites.length * whiteW;
  const [down, setDown] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Centre around middle C on first render
    const idx = whites.indexOf(60);
    if (scroller.current && idx > 0) scroller.current.scrollLeft = Math.max(0, idx * whiteW - scroller.current.clientWidth / 2 + whiteW * 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handlers = (m: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (disabled) return;
      e.preventDefault();
      setDown(m);
      onPress?.(m);
    },
    onPointerUp: () => {
      if (down === m) onRelease?.(m);
      setDown(null);
    },
    onPointerLeave: () => {
      if (down === m) {
        onRelease?.(m);
        setDown(null);
      }
    },
  });
  return (
    <div ref={scroller} className="no-scrollbar -mx-4 overflow-x-auto px-4" aria-label="Piano keyboard">
      <div className="relative h-40 touch-none select-none" style={{ width }}>
        {whites.map((m, i) => (
          <button
            key={m}
            aria-label={displayName(fromMidi(m), 'english', true)}
            {...handlers(m)}
            className={cx('absolute top-0 h-40 rounded-b-lg border border-slate-400', down === m ? 'bg-accent-2' : highlights.includes(m) ? 'bg-accent' : 'bg-slate-100')}
            style={{ left: i * whiteW, width: whiteW - 2 }}
          >
            {m % 12 === 0 && <span className="absolute bottom-1 left-0 right-0 text-center text-[10px] font-semibold text-slate-500">C{m / 12 - 1}</span>}
          </button>
        ))}
        {Array.from({ length: high - low + 1 }, (_, k) => low + k)
          .filter(isBlack)
          .map((m) => {
            const leftWhite = whites.indexOf(m - 1);
            return (
              <button
                key={m}
                aria-label={displayName(fromMidi(m), 'english', true)}
                {...handlers(m)}
                className={cx('absolute top-0 z-10 h-24 rounded-b-md border border-slate-900', down === m ? 'bg-accent-2' : highlights.includes(m) ? 'bg-accent' : 'bg-slate-900')}
                style={{ left: (leftWhite + 1) * whiteW - 15, width: 28 }}
              />
            );
          })}
      </div>
    </div>
  );
}

/** Seven letter buttons with optional accidental and octave rows. */
export function LetterPad({
  onAnswer,
  naming,
  accidentals,
  octaves,
  disabled,
  feedback,
}: {
  onAnswer: (letter: Letter, accidental: Accidental, octave?: number) => void;
  naming: NoteNaming;
  accidentals: boolean;
  octaves?: number[];
  disabled?: boolean;
  feedback?: { correct: Letter; chosen?: Letter } | null;
}) {
  const [acc, setAcc] = useState<Accidental>(0);
  const [oct, setOct] = useState<number | undefined>(undefined);
  const letters: Letter[] = naming === 'solfege' ? ['C', 'D', 'E', 'F', 'G', 'A', 'B'] : ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (/^[a-g]$/.test(k)) {
        e.preventDefault();
        submit(k.toUpperCase() as Letter);
      } else if (k === '#' || k === 's') setAcc((a) => (a === 1 ? 0 : 1));
      else if (k === 'b' && e.shiftKey) setAcc((a) => (a === -1 ? 0 : -1));
      else if (k === 'n') setAcc(0);
      else if (octaves && /^[1-8]$/.test(k) && octaves.includes(Number(k))) setOct(Number(k));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const submit = (l: Letter) => {
    if (disabled) return;
    if (octaves && oct === undefined) return;
    onAnswer(l, accidentals ? acc : 0, oct);
    setAcc(0);
  };

  return (
    <div className="space-y-2">
      {octaves && (
        <div className="flex gap-1.5" role="radiogroup" aria-label="Octave">
          {octaves.map((o) => (
            <button key={o} role="radio" aria-checked={oct === o} onClick={() => setOct(o)} className={cx('min-h-11 flex-1 rounded-xl border text-sm font-bold', oct === o ? 'border-accent-2 bg-accent-2/15 text-accent-2' : 'border-line bg-panel-2 text-muted')}>
              {o}
            </button>
          ))}
        </div>
      )}
      {accidentals && (
        <div className="flex gap-1.5" role="radiogroup" aria-label="Accidental">
          {([[-1, '♭'], [0, '♮'], [1, '♯']] as [Accidental, string][]).map(([a, s]) => (
            <button key={a} role="radio" aria-checked={acc === a} onClick={() => setAcc(a)} className={cx('min-h-11 flex-1 rounded-xl border text-xl', acc === a ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel-2 text-muted')}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-7 gap-1.5">
        {letters.map((l) => {
          const isCorrect = feedback && feedback.correct === l;
          const isWrong = feedback && feedback.chosen === l && feedback.chosen !== feedback.correct;
          return (
            <button
              key={l}
              disabled={disabled || (!!octaves && oct === undefined)}
              onClick={() => submit(l)}
              className={cx(
                'flex min-h-16 flex-col items-center justify-center rounded-2xl border text-2xl font-bold transition active:scale-95 disabled:opacity-60',
                isCorrect ? 'border-good bg-good/20 text-good' : isWrong ? 'border-bad bg-bad/20 text-bad' : 'border-line bg-panel-2 text-ink hover:border-accent/60',
              )}
            >
              <span className={naming === 'solfege' ? 'text-base' : ''}>{naming === 'solfege' ? SOLFEGE[l] : l}</span>
            </button>
          );
        })}
      </div>
      {octaves && oct === undefined && <p className="text-center text-xs text-muted">Choose an octave first</p>}
    </div>
  );
}

export function TapPad({ onDown, onUp, disabled, label = 'Tap the rhythm' }: { onDown: () => void; onUp: () => void; disabled?: boolean; label?: string }) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !disabled) {
        e.preventDefault();
        setActive(true);
        onDown();
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !disabled) {
        e.preventDefault();
        setActive(false);
        onUp();
      }
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, [onDown, onUp, disabled]);
  return (
    <button
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        setActive(true);
        onDown();
      }}
      onPointerUp={() => {
        setActive(false);
        onUp();
      }}
      onPointerCancel={() => {
        setActive(false);
        onUp();
      }}
      className={cx(
        'flex h-36 w-full touch-none select-none items-center justify-center rounded-3xl border-2 text-lg font-semibold transition disabled:opacity-40',
        active ? 'scale-[0.98] border-accent bg-accent/25 text-accent' : 'border-line bg-panel-2 text-muted',
      )}
    >
      {label}
      <span className="ml-2 hidden text-xs text-faint sm:inline">(or Space)</span>
    </button>
  );
}

export { midiAt };
