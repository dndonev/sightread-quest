import { type Accidental, type Pitch, diatonicIndex, fromDiatonicIndex, midi } from './pitch';

/**
 * An interval is a generic size in letter steps (0 = unison, 2 = third …)
 * plus an exact size in semitones. Transposing by letter steps first, then
 * fixing the accidental, guarantees correct enharmonic spelling
 * (C + major third = E, never Fb; C + augmented second = D#, never Eb).
 */
export interface Interval {
  steps: number;
  semitones: number;
}

/** Chord-degree style interval names relative to a root. */
export const DEGREES = {
  '1': { steps: 0, semitones: 0 },
  b2: { steps: 1, semitones: 1 },
  '2': { steps: 1, semitones: 2 },
  b3: { steps: 2, semitones: 3 },
  '3': { steps: 2, semitones: 4 },
  '4': { steps: 3, semitones: 5 },
  '#4': { steps: 3, semitones: 6 },
  b5: { steps: 4, semitones: 6 },
  '5': { steps: 4, semitones: 7 },
  '#5': { steps: 4, semitones: 8 },
  b6: { steps: 5, semitones: 8 },
  '6': { steps: 5, semitones: 9 },
  bb7: { steps: 6, semitones: 9 },
  b7: { steps: 6, semitones: 10 },
  '7': { steps: 6, semitones: 11 },
  b9: { steps: 8, semitones: 13 },
  '9': { steps: 8, semitones: 14 },
  '#9': { steps: 8, semitones: 15 },
  '11': { steps: 10, semitones: 17 },
  '#11': { steps: 10, semitones: 18 },
  b13: { steps: 12, semitones: 20 },
  '13': { steps: 12, semitones: 21 },
} as const satisfies Record<string, Interval>;

export type Degree = keyof typeof DEGREES;

export function transpose(p: Pitch, iv: Interval): Pitch {
  const target = fromDiatonicIndex(diatonicIndex(p) + iv.steps);
  const naturalMidi = midi(target);
  const acc = midi(p) + iv.semitones - naturalMidi;
  if (acc < -2 || acc > 2) throw new Error(`Cannot spell interval from ${p.letter}${p.accidental}: accidental ${acc}`);
  return { ...target, accidental: acc as Accidental };
}

export function transposeDown(p: Pitch, iv: Interval): Pitch {
  return transpose(p, { steps: -iv.steps, semitones: -iv.semitones });
}

export function intervalBetween(low: Pitch, high: Pitch): Interval {
  return { steps: diatonicIndex(high) - diatonicIndex(low), semitones: midi(high) - midi(low) };
}

/** Perfect-type generic intervals (unison, 4th, 5th) mod 7 */
const PERFECT_CLASSES = new Set([0, 3, 4]);
/** Semitones of the major/perfect interval for each simple generic size. */
const REFERENCE_SEMIS = [0, 2, 4, 5, 7, 9, 11];

export type IntervalQuality = 'P' | 'M' | 'm' | 'A' | 'd' | 'AA' | 'dd';

/**
 * Name an interval like "M3", "P5", "m7", "A4", "M9", "P11".
 * Compound intervals keep their compound number (a 10th is "M10").
 */
export function intervalName(iv: Interval): string {
  if (iv.steps < 0) return intervalName({ steps: -iv.steps, semitones: -iv.semitones });
  const simple = iv.steps % 7;
  const octaves = Math.floor(iv.steps / 7);
  const ref = REFERENCE_SEMIS[simple] + 12 * octaves;
  const diff = iv.semitones - ref;
  let q: IntervalQuality;
  if (PERFECT_CLASSES.has(simple)) {
    q = diff === 0 ? 'P' : diff === 1 ? 'A' : diff === -1 ? 'd' : diff === 2 ? 'AA' : 'dd';
  } else {
    q = diff === 0 ? 'M' : diff === -1 ? 'm' : diff === 1 ? 'A' : diff === -2 ? 'd' : diff === 2 ? 'AA' : 'dd';
  }
  return `${q}${iv.steps + 1}`;
}

const NUMBER_WORDS: Record<number, string> = {
  1: 'unison', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', 6: '6th', 7: '7th', 8: 'octave',
  9: '9th', 10: '10th', 11: '11th', 12: '12th', 13: '13th', 14: '14th', 15: 'two octaves',
};
const QUALITY_WORDS: Record<string, string> = {
  P: 'perfect', M: 'major', m: 'minor', A: 'augmented', d: 'diminished', AA: 'doubly augmented', dd: 'doubly diminished',
};

export function intervalLongName(iv: Interval): string {
  const short = intervalName(iv);
  const m = /^(AA|dd|P|M|m|A|d)(\d+)$/.exec(short)!;
  const n = Number(m[2]);
  return `${QUALITY_WORDS[m[1]]} ${NUMBER_WORDS[n] ?? `${n}th`}`;
}
