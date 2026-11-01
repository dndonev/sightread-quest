import { type Pitch, midi, shiftOctave } from './pitch';

/**
 * Guitar conventions
 * ------------------
 * Guitar music is written in treble clef one octave HIGHER than it sounds.
 * The open high E string sounds E4 (MIDI 64) but is written E5.
 * All fretboard math here uses SOUNDING MIDI numbers; convert at the edges.
 */
export const GUITAR_TRANSPOSITION_OCTAVES = 1;

/** Standard tuning, sounding pitch, string 6 (low E) → string 1 (high E). */
export const STANDARD_TUNING_MIDI = [40, 45, 50, 55, 59, 64] as const;
export const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'] as const;
export const MAX_FRET = 15;

/** Written range of the guitar on frets 0–15: E3 … G6 written (E2 … G5 sounding). */
export const GUITAR_WRITTEN_LOW_MIDI = STANDARD_TUNING_MIDI[0] + 12;
export const GUITAR_WRITTEN_HIGH_MIDI = STANDARD_TUNING_MIDI[5] + MAX_FRET + 12;

export function writtenToSounding(written: Pitch): Pitch {
  return shiftOctave(written, -GUITAR_TRANSPOSITION_OCTAVES);
}

export function soundingToWritten(sounding: Pitch): Pitch {
  return shiftOctave(sounding, GUITAR_TRANSPOSITION_OCTAVES);
}

export function writtenMidiToSounding(m: number): number {
  return m - 12 * GUITAR_TRANSPOSITION_OCTAVES;
}

export interface FretPosition {
  /** String index 0 = low E (6th string) … 5 = high e (1st string) */
  string: number;
  fret: number;
}

/** Human string number (1 = high e, 6 = low E). */
export function stringNumber(stringIndex: number): number {
  return 6 - stringIndex;
}

/** Every place a SOUNDING pitch can be played on frets 0..maxFret. */
export function positionsForMidi(soundingMidi: number, maxFret = MAX_FRET): FretPosition[] {
  const out: FretPosition[] = [];
  STANDARD_TUNING_MIDI.forEach((open, string) => {
    const fret = soundingMidi - open;
    if (fret >= 0 && fret <= maxFret) out.push({ string, fret });
  });
  return out;
}

export function midiAt(pos: FretPosition): number {
  return STANDARD_TUNING_MIDI[pos.string] + pos.fret;
}

export interface Fingering {
  positions: FretPosition[];
  /** Lowest fretted fret (hand position), 0 if all open. */
  baseFret: number;
  span: number;
}

/**
 * Finds a playable fingering for simultaneous SOUNDING notes:
 * one note per string, strings ascending with pitch, fretted notes within a
 * 4-fret span, at most 4 distinct fretted positions (barre allowed on the lowest fret).
 */
export function findChordFingering(soundingMidis: number[], maxSpan = 3): Fingering | null {
  const notes = [...soundingMidis].sort((a, b) => a - b);
  let best: Fingering | null = null;
  const scoreOf = (f: Fingering) => f.baseFret * 2 + f.span + (f.positions.some((p) => p.fret === 0) ? -0.5 : 0);

  const recurse = (i: number, minString: number, acc: FretPosition[]) => {
    if (i === notes.length) {
      const fretted = acc.filter((p) => p.fret > 0).map((p) => p.fret);
      const lo = fretted.length ? Math.min(...fretted) : 0;
      const hi = fretted.length ? Math.max(...fretted) : 0;
      const span = hi - lo;
      if (span > maxSpan) return;
      const nonBarre = fretted.filter((f) => f !== lo).length;
      const fingersNeeded = nonBarre + (fretted.includes(lo) ? 1 : 0);
      if (fingersNeeded > 4) return;
      // Open strings with frets beyond 7 are awkward but legal; penalise via score only.
      const f: Fingering = { positions: [...acc], baseFret: lo, span };
      if (!best || scoreOf(f) < scoreOf(best)) best = f;
      return;
    }
    for (let s = minString; s < 6; s++) {
      const fret = notes[i] - STANDARD_TUNING_MIDI[s];
      if (fret < 0 || fret > MAX_FRET) continue;
      // Strings between chosen strings are muted; that's fine for jazz/rootless voicings.
      acc.push({ string: s, fret });
      recurse(i + 1, s + 1, acc);
      acc.pop();
    }
  };
  recurse(0, 0, []);
  return best;
}

/**
 * Picks fretboard positions for a melody (SOUNDING MIDI), staying near one hand
 * position where possible. Greedy: minimise movement from the previous note.
 */
export function melodyPositions(soundingMidis: number[], preferredBase = 0): (FretPosition | null)[] {
  let handPos = preferredBase;
  return soundingMidis.map((m) => {
    const options = positionsForMidi(m);
    if (!options.length) return null;
    const cost = (p: FretPosition) => {
      if (p.fret === 0) return handPos <= 4 ? 0 : 3;
      const inBox = p.fret >= handPos && p.fret <= handPos + 4;
      return (inBox ? 0 : Math.min(Math.abs(p.fret - handPos), Math.abs(p.fret - (handPos + 4))) * 1.5) + p.fret * 0.05;
    };
    const best = options.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    if (best.fret > 0 && (best.fret < handPos || best.fret > handPos + 4)) handPos = Math.max(0, best.fret - 1);
    return best;
  });
}

export function isPlayableWrittenPitch(written: Pitch): boolean {
  const m = midi(written);
  return m >= GUITAR_WRITTEN_LOW_MIDI && m <= GUITAR_WRITTEN_HIGH_MIDI;
}

export function describePosition(p: FretPosition): string {
  const s = stringNumber(p.string);
  return p.fret === 0 ? `open string ${s}` : `string ${s}, fret ${p.fret}`;
}
