import { type Accidental, type Pitch, diatonicIndex, midi, parsePitch, pitchToString } from '../music-theory/pitch';
import { transpose } from '../music-theory/interval';
import { MeasureAccidentalState, type Mode, keyFromFifths, scale } from '../music-theory/keys';
import {
  type BaseDuration,
  type DurationSpec,
  type TimeSignature,
  beatTicks,
  beatsPerMeasure,
  durationTicks,
  isCompound,
  measureTicks,
  ticksToDuration,
} from '../music-theory/rhythm';
import type { Rng } from '../music-theory/random';
import type { Clef } from '../notation/staff';
import { GUITAR_WRITTEN_LOW_MIDI } from '../music-theory/guitar';
import type { Instrument } from '../persistence/types';
import { type ItemStat, mastery } from '../adaptive-learning/mastery';

/* ---------------- Data model ---------------- */

export interface ScoreEvent {
  id: number;
  measure: number;
  /** Absolute tick from the start of the exercise. */
  start: number;
  ticks: number;
  duration: DurationSpec;
  rest: boolean;
  /** Written pitches, low → high. Melody note is the highest. */
  pitches: Pitch[];
  /** Accidental sign to print for each pitch (null = none). */
  printed: (Accidental | null)[];
  tieToNext?: boolean;
  /** Continuation of a tie: no new onset. */
  tiedFromPrev?: boolean;
  /** Rhythm cell this event came from (for adaptive tracking). */
  cell?: string;
}

export interface Exercise {
  id: string;
  seed: number;
  level: number;
  title: string;
  keyFifths: number;
  mode: Mode;
  timeSig: TimeSignature;
  clef: Clef;
  measures: ScoreEvent[][];
  events: ScoreEvent[];
  totalTicks: number;
  suggestedTempo: number;
  source?: string;
}

/* ---------------- Levels ---------------- */

export interface ReadingLevel {
  level: number;
  title: string;
  description: string;
  timeSigs: TimeSignature[];
  cells: string[];
  measures: number;
  keys: number[];
  minor: boolean;
  /** Max melodic leap in scale steps. */
  maxLeap: number;
  rangeSteps: number;
  accidentalRate: number;
  restRate: number;
  tieRate: number;
  arpeggio: boolean;
  dyadRate: number;
  tempo: number;
  tunes: boolean;
}

const T44: TimeSignature = { beats: 4, beatValue: 4 };
const T34: TimeSignature = { beats: 3, beatValue: 4 };
const T24: TimeSignature = { beats: 2, beatValue: 4 };
const T68: TimeSignature = { beats: 6, beatValue: 8 };
const T128: TimeSignature = { beats: 12, beatValue: 8 };

const SIMPLE_L1 = ['q'];
const SIMPLE_L2 = ['q', '8 8', 'h'];
const SIMPLE_L3 = [...SIMPLE_L2, 'hd', 'w'];
const SIMPLE_L5 = [...SIMPLE_L3, 'qd 8', '8d 16', '8 q 8', '16 16 16 16', '8 16 16', '16 16 8'];
const COMPOUND = ['qd', 'q 8', '8 8 8', '8 q', 'hd', '8d 16 8', '16 16 8 8'];

export const READING_LEVELS: ReadingLevel[] = [
  { level: 1, title: 'Quarter-note steps', description: 'Stepwise quarter notes in C, slow tempo.', timeSigs: [T44], cells: SIMPLE_L1, measures: 4, keys: [0], minor: false, maxLeap: 1, rangeSteps: 5, accidentalRate: 0, restRate: 0, tieRate: 0, arpeggio: false, dyadRate: 0, tempo: 60, tunes: false },
  { level: 2, title: 'Halves, eighths & rests', description: 'Mixed values and rests; thirds appear.', timeSigs: [T44, T34, T24], cells: SIMPLE_L2, measures: 4, keys: [0], minor: false, maxLeap: 2, rangeSteps: 6, accidentalRate: 0, restRate: 0.12, tieRate: 0, arpeggio: false, dyadRate: 0, tempo: 66, tunes: false },
  { level: 3, title: 'Leaps & variation', description: 'Fourths and fifths, dotted halves, sequences.', timeSigs: [T44, T34], cells: SIMPLE_L3, measures: 4, keys: [0, 1, -1], minor: false, maxLeap: 4, rangeSteps: 8, accidentalRate: 0, restRate: 0.12, tieRate: 0, arpeggio: false, dyadRate: 0, tempo: 72, tunes: false },
  { level: 4, title: 'Keys & accidentals', description: 'Key signatures up to 3 sharps/flats, minor keys, chromatic tones.', timeSigs: [T44, T34], cells: SIMPLE_L3, measures: 4, keys: [-3, -2, -1, 0, 1, 2, 3], minor: true, maxLeap: 4, rangeSteps: 9, accidentalRate: 0.12, restRate: 0.1, tieRate: 0, arpeggio: false, dyadRate: 0, tempo: 72, tunes: false },
  { level: 5, title: 'Syncopation & dots', description: 'Dotted rhythms, syncopation, sixteenths and ties.', timeSigs: [T44, T24, T34], cells: SIMPLE_L5, measures: 4, keys: [-2, -1, 0, 1, 2], minor: true, maxLeap: 4, rangeSteps: 9, accidentalRate: 0.08, restRate: 0.08, tieRate: 0.25, arpeggio: false, dyadRate: 0, tempo: 72, tunes: false },
  { level: 6, title: 'Arpeggios & chords', description: 'Arpeggiated harmony and double-stops.', timeSigs: [T44, T34], cells: SIMPLE_L3.concat(['8d 16']), measures: 4, keys: [-2, -1, 0, 1, 2, 3], minor: true, maxLeap: 7, rangeSteps: 11, accidentalRate: 0.06, restRate: 0.06, tieRate: 0.1, arpeggio: true, dyadRate: 0.2, tempo: 76, tunes: false },
  { level: 7, title: 'Compound time', description: '6/8 and 12/8 with mixed rhythms.', timeSigs: [T68, T128, T68], cells: COMPOUND, measures: 4, keys: [-2, -1, 0, 1, 2], minor: true, maxLeap: 4, rangeSteps: 9, accidentalRate: 0.06, restRate: 0.06, tieRate: 0.1, arpeggio: false, dyadRate: 0, tempo: 56, tunes: false },
  { level: 8, title: 'No stopping', description: 'Eight-bar phrases mixing everything so far.', timeSigs: [T44, T34, T68], cells: SIMPLE_L5, measures: 8, keys: [-3, -2, -1, 0, 1, 2, 3], minor: true, maxLeap: 5, rangeSteps: 10, accidentalRate: 0.08, restRate: 0.08, tieRate: 0.2, arpeggio: false, dyadRate: 0.05, tempo: 80, tunes: false },
  { level: 9, title: 'Guitar-style', description: 'Wider range, more accidentals, double-stops, sixteenths.', timeSigs: [T44, T34, T68], cells: SIMPLE_L5, measures: 8, keys: [-4, -3, -2, -1, 0, 1, 2, 3, 4], minor: true, maxLeap: 7, rangeSteps: 13, accidentalRate: 0.12, restRate: 0.06, tieRate: 0.2, arpeggio: true, dyadRate: 0.18, tempo: 84, tunes: false },
  { level: 10, title: 'Unfamiliar pieces', description: 'Folk melodies in new keys and long generated pieces at a steady tempo.', timeSigs: [T44, T34, T68, T24], cells: SIMPLE_L5, measures: 8, keys: [-4, -3, -2, -1, 0, 1, 2, 3, 4], minor: true, maxLeap: 7, rangeSteps: 13, accidentalRate: 0.1, restRate: 0.06, tieRate: 0.2, arpeggio: true, dyadRate: 0.1, tempo: 88, tunes: true },
];

export function readingLevel(level: number): ReadingLevel {
  return READING_LEVELS[Math.max(0, Math.min(READING_LEVELS.length - 1, level - 1))];
}

/* ---------------- Rhythm ---------------- */

interface Token {
  duration: DurationSpec;
  rest: boolean;
}

function parseToken(t: string): Token {
  const rest = t.endsWith('r');
  const core = rest ? t.slice(0, -1) : t;
  const dots = core.endsWith('d') ? 1 : 0;
  const base = (dots ? core.slice(0, -1) : core) as BaseDuration;
  return { duration: { base, dots: dots as 0 | 1 }, rest };
}

export function cellTicks(cell: string): number {
  return cell.split(' ').map(parseToken).reduce((s, t) => s + durationTicks(t.duration), 0);
}

export function rhythmItemKey(cell: string, ts: TimeSignature): string {
  return `rhythm:${isCompound(ts) ? 'c' : 's'}:${cell}`;
}

/**
 * Fill one measure with rhythm cells. Cells longer than a beat may only start
 * on strong beats so the beat structure stays readable.
 */
export function generateMeasureRhythm(
  rng: Rng,
  ts: TimeSignature,
  cells: string[],
  options: { restRate: number; final?: boolean; weight?: (cell: string) => number },
): { tokens: Token[]; cell: string }[] {
  const beat = beatTicks(ts);
  const total = measureTicks(ts);
  const nBeats = beatsPerMeasure(ts);
  const valid = cells.filter((c) => cellTicks(c) % beat === 0 || cellTicks(c) === beat);
  const out: { tokens: Token[]; cell: string }[] = [];
  let pos = 0;
  while (pos < total) {
    const remaining = total - pos;
    const beatIndex = pos / beat;
    if (options.final && remaining <= total / 2 + (nBeats % 2 ? beat / 2 : 0)) {
      const d = ticksToDuration(remaining);
      if (d) {
        out.push({ tokens: [{ duration: d, rest: false }], cell: 'final' });
        break;
      }
    }
    const fits = valid.filter((c) => {
      const t = cellTicks(c);
      if (t > remaining) return false;
      const beats = t / beat;
      if (beats >= 2 && nBeats === 4 && beatIndex % 2 !== 0) return false; // 2-beat groups start on 1 or 3
      if (beats === 3 && beatIndex !== 0) return false;
      if (beats === 4 && beatIndex !== 0) return false;
      return true;
    });
    const choice = fits.length ? rng.weighted(fits, (c) => (options.weight?.(c) ?? 1) * (c.split(' ').length > 2 ? 0.8 : 1)) : null;
    const cell = choice ?? (isCompound(ts) ? 'qd' : 'q');
    let tokens = cell.split(' ').map(parseToken);
    if (options.restRate > 0 && rng.chance(options.restRate) && !(options.final && pos + cellTicks(cell) >= total)) {
      const i = rng.int(0, tokens.length - 1);
      tokens = tokens.map((t, j) => (j === i ? { ...t, rest: true } : t));
    }
    out.push({ tokens, cell });
    pos += cellTicks(cell);
  }
  return out;
}

/* ---------------- Melody ---------------- */

interface MelodyContext {
  scalePitches: Pitch[];
  minDeg: number;
  maxDeg: number;
}

function pitchForDegree(ctx: MelodyContext, deg: number): Pitch {
  const n = ctx.scalePitches.length;
  const idx = ((deg % n) + n) % n;
  const oct = Math.floor(deg / n);
  const p = ctx.scalePitches[idx];
  return { ...p, octave: p.octave + oct };
}

function chooseTonicOctave(tonic: Pick<Pitch, 'letter' | 'accidental'>, clef: Clef, instrument: Instrument, rangeSteps: number, mode: Mode): { octave: number; minDeg: number; maxDeg: number } {
  const center = clef === 'treble' ? parsePitch(instrument === 'guitar' ? 'A4' : 'B4') : parsePitch('D3');
  let best = { octave: 4, minDeg: 0, maxDeg: rangeSteps - 1, cost: Infinity };
  for (let octave = 1; octave <= 6; octave++) {
    // Range spans from a bit below the tonic: degrees -k … rangeSteps-1-k
    for (let k = 0; k <= Math.min(4, rangeSteps - 4); k++) {
      const minDeg = -k;
      const maxDeg = rangeSteps - 1 - k;
      const sc = scale(tonic, mode === 'minor' ? 'harmonic-minor' : 'major', octave);
      const ctx = { scalePitches: sc, minDeg, maxDeg };
      const lo = pitchForDegree(ctx, minDeg);
      const hi = pitchForDegree(ctx, maxDeg);
      const mid = (diatonicIndex(lo) + diatonicIndex(hi)) / 2;
      let cost = Math.abs(mid - diatonicIndex(center)) + k * 0.3;
      if (instrument === 'guitar' && clef === 'treble' && midi(lo) < GUITAR_WRITTEN_LOW_MIDI) cost += 100;
      if (cost < best.cost) best = { octave, minDeg, maxDeg, cost };
    }
  }
  return best;
}

/** Next scale degree for a melodic walk, favouring steps and gap-filling after leaps. */
export function nextDegree(rng: Rng, current: number, prevInterval: number, ctx: MelodyContext, maxLeap: number): number {
  const moves: { d: number; w: number }[] = [];
  for (let d = -maxLeap; d <= maxLeap; d++) {
    const target = current + d;
    if (target < ctx.minDeg || target > ctx.maxDeg) continue;
    const a = Math.abs(d);
    let w = a === 0 ? 0.8 : a === 1 ? 6 : a === 2 ? 3 : a <= 4 ? 1.4 : a === 7 ? 0.6 : 0.4;
    // After a leap, prefer a step back in the opposite direction.
    if (Math.abs(prevInterval) >= 3) {
      if (Math.sign(d) === -Math.sign(prevInterval) && a <= 2) w *= 3;
      else if (Math.sign(d) === Math.sign(prevInterval) && a >= 2) w *= 0.2;
    }
    moves.push({ d, w });
  }
  if (!moves.length) return Math.max(ctx.minDeg, Math.min(ctx.maxDeg, current));
  return current + rng.weighted(moves, (m) => m.w).d;
}

/* ---------------- Generator ---------------- */

export interface ExerciseConfig {
  level: number;
  instrument: Instrument;
  clef: Clef;
  measures?: number;
  stats?: Record<string, ItemStat>;
  /** Force a real-world tune (level 10). */
  preferTune?: boolean;
}

let exerciseCounter = 0;

export function generateExercise(cfg: ExerciseConfig, rng: Rng): Exercise {
  const lvl = readingLevel(cfg.level);
  if (lvl.tunes && (cfg.preferTune || rng.chance(0.4))) {
    const tune = tuneExercise(rng, cfg);
    if (tune) return tune;
  }
  const ts = rng.pick(lvl.timeSigs);
  const compound = isCompound(ts);
  const cells = compound ? (lvl.level >= 7 ? COMPOUND : ['qd', 'q 8', '8 8 8']) : lvl.cells;
  const fifths = rng.pick(lvl.keys);
  const mode: Mode = lvl.minor && rng.chance(0.3) ? 'minor' : 'major';
  const key = keyFromFifths(fifths, mode);
  const range = chooseTonicOctave(key.tonic, cfg.clef, cfg.instrument, lvl.rangeSteps, mode);
  const ctx: MelodyContext = {
    scalePitches: scale(key.tonic, mode === 'minor' ? 'harmonic-minor' : 'major', range.octave),
    minDeg: range.minDeg,
    maxDeg: range.maxDeg,
  };
  const nMeasures = cfg.measures ?? lvl.measures;
  const weight = (cell: string) => 1 + 2 * (1 - mastery(cfg.stats?.[rhythmItemKey(cell, ts)], 1000));

  // Rhythm: phrase structure a a' b a'' — measure 3 of each 4 reuses measure 1's rhythm.
  const rhythms: ReturnType<typeof generateMeasureRhythm>[] = [];
  for (let m = 0; m < nMeasures; m++) {
    const final = m === nMeasures - 1;
    if (!final && m % 4 === 2 && rhythms[m - 2] && rng.chance(0.7)) rhythms.push(rhythms[m - 2]);
    else rhythms.push(generateMeasureRhythm(rng, ts, cells, { restRate: lvl.restRate, final, weight }));
  }

  // Harmony for arpeggio levels: I IV V I per measure (degrees relative to tonic).
  const harmony = [0, 3, 4, 0, 5, 1, 4, 0];

  const events: ScoreEvent[] = [];
  const measures: ScoreEvent[][] = [];
  let tick = 0;
  let id = 0;
  let deg = rng.pick([0, 2, 4].filter((d) => d >= ctx.minDeg && d <= ctx.maxDeg));
  let prevInterval = 0;

  for (let m = 0; m < nMeasures; m++) {
    const mEvents: ScoreEvent[] = [];
    const final = m === nMeasures - 1;
    const chordRoot = harmony[m % harmony.length];
    const arpeggioMeasure = lvl.arpeggio && !final && rng.chance(0.5);
    const tokens = rhythms[m].flatMap((c) => c.tokens.map((t) => ({ ...t, cell: c.cell })));
    tokens.forEach((t, i) => {
      const ticks = durationTicks(t.duration);
      const ev: ScoreEvent = { id: id++, measure: m, start: tick, ticks, duration: t.duration, rest: t.rest, pitches: [], printed: [], cell: t.cell };
      if (!t.rest) {
        const isLastNote = final && i === tokens.length - 1;
        const isPenultimate = final && i === tokens.length - 2;
        if (isLastNote) {
          deg = [0, 7, -7].map((d) => d).filter((d) => d >= ctx.minDeg && d <= ctx.maxDeg).sort((a, b) => Math.abs(a - deg) - Math.abs(b - deg))[0] ?? 0;
        } else if (isPenultimate) {
          const opts = [1, -1, 4, 6, 8].filter((d) => d >= ctx.minDeg && d <= ctx.maxDeg);
          if (opts.length) deg = opts.sort((a, b) => Math.abs(a - deg) - Math.abs(b - deg))[0];
        } else if (arpeggioMeasure) {
          const chordTonesDeg = [chordRoot, chordRoot + 2, chordRoot + 4, chordRoot + 7, chordRoot - 3, chordRoot - 5].filter((d) => d >= ctx.minDeg && d <= ctx.maxDeg);
          const near = chordTonesDeg.filter((d) => d !== deg).sort((a, b) => Math.abs(a - deg) - Math.abs(b - deg)).slice(0, 3);
          if (near.length) deg = rng.pick(near);
        } else {
          const nd = nextDegree(rng, deg, prevInterval, ctx, lvl.maxLeap);
          prevInterval = nd - deg;
          deg = nd;
        }
        const melody = pitchForDegree(ctx, deg);
        ev.pitches = [melody];
        if (lvl.dyadRate > 0 && ticks >= 48 && !isLastNote && rng.chance(lvl.dyadRate)) {
          // Diatonic 3rd or 6th below, like guitar double-stops.
          const below = rng.pick([2, 5]);
          if (deg - below >= ctx.minDeg - 2) ev.pitches = [pitchForDegree(ctx, deg - below), melody];
        }
      }
      mEvents.push(ev);
      tick += ticks;
    });
    measures.push(mEvents);
    events.push(...mEvents);
  }

  // Ties across the barline: repeat the last pitch of a measure into the next downbeat.
  if (lvl.tieRate > 0) {
    for (let m = 0; m < measures.length - 1; m++) {
      const last = measures[m][measures[m].length - 1];
      const first = measures[m + 1][0];
      if (!last.rest && !first.rest && last.pitches.length === 1 && first.pitches.length === 1 && rng.chance(lvl.tieRate) && m + 1 < measures.length - 1) {
        first.pitches = [...last.pitches];
        last.tieToNext = true;
        first.tiedFromPrev = true;
      }
    }
  }

  // Chromatic approach tones: raise a note that rises by a whole step into the next note.
  if (lvl.accidentalRate > 0) {
    const notes = events.filter((e) => !e.rest && e.pitches.length === 1 && !e.tieToNext && !e.tiedFromPrev);
    for (let i = 0; i < notes.length - 1; i++) {
      const a = notes[i].pitches[0];
      const b = notes[i + 1].pitches[0];
      if (midi(b) - midi(a) === 2 && diatonicIndex(b) - diatonicIndex(a) === 1 && a.accidental < 1 && !(a.accidental === 0 && (a.letter === 'E' || a.letter === 'B')) && rng.chance(lvl.accidentalRate * 2)) {
        notes[i].pitches = [{ ...a, accidental: (a.accidental + 1) as Accidental }];
      }
    }
  }

  applyPrintedAccidentals(measures, fifths);
  return {
    id: `ex${++exerciseCounter}`,
    seed: rng.seed,
    level: cfg.level,
    title: `${key.tonic.letter}${key.tonic.accidental === 1 ? '♯' : key.tonic.accidental === -1 ? '♭' : ''} ${mode} · ${ts.beats}/${ts.beatValue}`,
    keyFifths: fifths,
    mode,
    timeSig: ts,
    clef: cfg.clef,
    measures,
    events,
    totalTicks: tick,
    suggestedTempo: lvl.tempo,
  };
}

/** Decide which accidental signs must be printed, measure by measure. */
export function applyPrintedAccidentals(measures: ScoreEvent[][], fifths: number) {
  for (const m of measures) {
    const state = new MeasureAccidentalState(fifths);
    for (const ev of m) {
      if (ev.tiedFromPrev && ev === m[0]) {
        // A tie into a new bar carries the accidental without reprinting it.
        ev.printed = ev.pitches.map(() => null);
        continue;
      }
      ev.printed = ev.pitches.map((p) => state.displayFor(p));
    }
  }
}

/* ---------------- Real-world melodies (public domain) ---------------- */

export const TUNES: { name: string; ts: TimeSignature; melody: string }[] = [
  {
    name: 'Ode to Joy (Beethoven)',
    ts: T44,
    melody:
      'E4:q E4:q F4:q G4:q | G4:q F4:q E4:q D4:q | C4:q C4:q D4:q E4:q | E4:qd D4:8 D4:h | E4:q E4:q F4:q G4:q | G4:q F4:q E4:q D4:q | C4:q C4:q D4:q E4:q | D4:qd C4:8 C4:h',
  },
  {
    name: 'Frère Jacques (trad.)',
    ts: T44,
    melody:
      'C4:q D4:q E4:q C4:q | C4:q D4:q E4:q C4:q | E4:q F4:q G4:h | E4:q F4:q G4:h | G4:8 A4:8 G4:8 F4:8 E4:q C4:q | G4:8 A4:8 G4:8 F4:8 E4:q C4:q | C4:q G3:q C4:h | C4:q G3:q C4:h',
  },
  {
    name: 'Twinkle, Twinkle (trad.)',
    ts: T44,
    melody:
      'C4:q C4:q G4:q G4:q | A4:q A4:q G4:h | F4:q F4:q E4:q E4:q | D4:q D4:q C4:h | G4:q G4:q F4:q F4:q | E4:q E4:q D4:h | G4:q G4:q F4:q F4:q | E4:q E4:q D4:h',
  },
  {
    name: 'Mary Had a Little Lamb (trad.)',
    ts: T44,
    melody:
      'E4:q D4:q C4:q D4:q | E4:q E4:q E4:h | D4:q D4:q D4:h | E4:q G4:q G4:h | E4:q D4:q C4:q D4:q | E4:q E4:q E4:q E4:q | D4:q D4:q E4:q D4:q | C4:w',
  },
];

/** Parse "E4:q D4:8d r:q | …" into measures (pitches in C, written). */
export function parseTune(melody: string): { pitch: Pitch | null; duration: DurationSpec }[][] {
  return melody.split('|').map((bar) =>
    bar
      .trim()
      .split(/\s+/)
      .map((tok) => {
        const [p, d] = tok.split(':');
        const t = parseToken(d);
        return { pitch: p === 'r' ? null : parsePitch(p), duration: t.duration };
      }),
  );
}

const TUNE_TRANSPOSITIONS: { fifths: number; steps: number; semitones: number }[] = [
  { fifths: 0, steps: 0, semitones: 0 },
  { fifths: 1, steps: -3, semitones: -5 }, // to G
  { fifths: -1, steps: 3, semitones: 5 }, // to F
  { fifths: 2, steps: 1, semitones: 2 }, // to D
  { fifths: -2, steps: -1, semitones: -2 }, // to Bb
  { fifths: 3, steps: 5, semitones: 9 }, // to A
];

function tuneExercise(rng: Rng, cfg: ExerciseConfig): Exercise | null {
  const tune = rng.pick(TUNES);
  const tr = rng.pick(TUNE_TRANSPOSITIONS);
  const bars = parseTune(tune.melody);
  const octaveShift = cfg.clef === 'bass' ? -2 : cfg.instrument === 'guitar' ? 0 : 1;
  const measures: ScoreEvent[][] = [];
  const events: ScoreEvent[] = [];
  let tick = 0;
  let id = 0;
  bars.forEach((bar, m) => {
    const mev: ScoreEvent[] = [];
    for (const n of bar) {
      let pitches: Pitch[] = [];
      if (n.pitch) {
        let p = transpose(n.pitch, { steps: tr.steps, semitones: tr.semitones });
        p = { ...p, octave: p.octave + octaveShift };
        pitches = [p];
      }
      const ticks = durationTicks(n.duration);
      const ev: ScoreEvent = { id: id++, measure: m, start: tick, ticks, duration: n.duration, rest: !n.pitch, pitches, printed: [] };
      mev.push(ev);
      tick += ticks;
    }
    measures.push(mev);
    events.push(...mev);
  });
  // Ensure guitar range
  if (cfg.instrument === 'guitar' && cfg.clef === 'treble' && events.some((e) => e.pitches.some((p) => midi(p) < GUITAR_WRITTEN_LOW_MIDI))) {
    events.forEach((e) => (e.pitches = e.pitches.map((p) => ({ ...p, octave: p.octave + 1 }))));
  }
  applyPrintedAccidentals(measures, tr.fifths);
  const key = keyFromFifths(tr.fifths);
  return {
    id: `ex${++exerciseCounter}`,
    seed: rng.seed,
    level: cfg.level,
    title: `${tune.name} · ${key.tonic.letter}${key.tonic.accidental === -1 ? '♭' : key.tonic.accidental === 1 ? '♯' : ''} major`,
    keyFifths: tr.fifths,
    mode: 'major',
    timeSig: tune.ts,
    clef: cfg.clef,
    measures,
    events,
    totalTicks: tick,
    suggestedTempo: readingLevel(cfg.level).tempo,
    source: tune.name,
  };
}

/* ---------------- Helpers for playback & evaluation ---------------- */

/** Events that produce a new onset (notes, excluding tie continuations). */
export function onsetEvents(ex: Exercise): ScoreEvent[] {
  return ex.events.filter((e) => !e.rest && !e.tiedFromPrev);
}

/** Total sounding length of a note including tied continuations. */
export function soundingTicks(ex: Exercise, ev: ScoreEvent): number {
  let t = ev.ticks;
  let i = ex.events.indexOf(ev);
  while (ex.events[i]?.tieToNext && ex.events[i + 1]) {
    t += ex.events[i + 1].ticks;
    i++;
  }
  return t;
}

export function melodyPitch(ev: ScoreEvent): Pitch {
  return ev.pitches[ev.pitches.length - 1];
}

export function eventAt(ex: Exercise, tick: number): ScoreEvent | undefined {
  return ex.events.find((e) => tick >= e.start && tick < e.start + e.ticks);
}

export function describeExercise(ex: Exercise): string {
  return ex.events.map((e) => (e.rest ? `r:${e.duration.base}` : `${e.pitches.map(pitchToString).join('+')}:${e.duration.base}${e.duration.dots ? 'd' : ''}`)).join(' ');
}
