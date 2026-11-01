/**
 * Core pitch model.
 *
 * A Pitch is a *spelled* pitch: letter + accidental + octave (scientific pitch
 * notation, C4 = middle C). Spelling matters for notation: C#4 and Db4 share a
 * MIDI number but sit on different staff positions.
 *
 * Octave numbers follow the letter, not the sounding key: B#3 has octave 3
 * even though it sounds like C4 (MIDI 60). Cb4 sounds like B3 (MIDI 59).
 */

export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export type Accidental = -2 | -1 | 0 | 1 | 2;

export interface Pitch {
  letter: Letter;
  accidental: Accidental;
  octave: number;
}

export const LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const LETTER_SEMITONES: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const SOLFEGE: Record<Letter, string> = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };

export type NoteNaming = 'english' | 'solfege';

export function letterIndex(letter: Letter): number {
  return LETTERS.indexOf(letter);
}

export function pitch(letter: Letter, accidental: Accidental, octave: number): Pitch {
  return { letter, accidental, octave };
}

/** MIDI note number (C4 = 60). */
export function midi(p: Pitch): number {
  return 12 * (p.octave + 1) + LETTER_SEMITONES[p.letter] + p.accidental;
}

/** Diatonic index: counts letter steps. C4 = 28, D4 = 29 … Used for staff positions. */
export function diatonicIndex(p: Pitch): number {
  return p.octave * 7 + letterIndex(p.letter);
}

export function fromDiatonicIndex(index: number, accidental: Accidental = 0): Pitch {
  const octave = Math.floor(index / 7);
  const letter = LETTERS[((index % 7) + 7) % 7];
  return { letter, accidental, octave };
}

export function frequency(p: Pitch | number): number {
  const m = typeof p === 'number' ? p : midi(p);
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function midiFromFrequency(f: number): number {
  return 69 + 12 * Math.log2(f / 440);
}

const ACC_ASCII: Record<Accidental, string> = { [-2]: 'bb', [-1]: 'b', 0: '', 1: '#', 2: '##' } as Record<Accidental, string>;
const ACC_SYMBOL: Record<Accidental, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' } as Record<Accidental, string>;

export function accidentalAscii(a: Accidental): string {
  return ACC_ASCII[a];
}

export function accidentalSymbol(a: Accidental, showNatural = false): string {
  if (a === 0) return showNatural ? '♮' : '';
  return ACC_SYMBOL[a];
}

/** "C#4", "Bb3" */
export function pitchToString(p: Pitch): string {
  return `${p.letter}${ACC_ASCII[p.accidental]}${p.octave}`;
}

/** "C#" (no octave) */
export function pitchClassString(p: Pick<Pitch, 'letter' | 'accidental'>): string {
  return `${p.letter}${ACC_ASCII[p.accidental]}`;
}

/** Human-readable name with Unicode accidentals: "C♯", "Sol♭" */
export function displayName(
  p: Pick<Pitch, 'letter' | 'accidental'> & { octave?: number },
  naming: NoteNaming = 'english',
  withOctave = false,
): string {
  const base = naming === 'solfege' ? SOLFEGE[p.letter] : p.letter;
  const oct = withOctave && p.octave !== undefined ? String(p.octave) : '';
  return `${base}${ACC_SYMBOL[p.accidental]}${oct}`;
}

export function parsePitch(s: string): Pitch {
  const m = /^([A-Ga-g])(##|bb|#|b|x)?(-?\d+)$/.exec(s.trim());
  if (!m) throw new Error(`Invalid pitch: ${s}`);
  const letter = m[1].toUpperCase() as Letter;
  const accMap: Record<string, Accidental> = { '': 0, '#': 1, '##': 2, x: 2, b: -1, bb: -2 };
  return { letter, accidental: accMap[m[2] ?? ''], octave: Number(m[3]) };
}

export function parsePitchClass(s: string): Pick<Pitch, 'letter' | 'accidental'> {
  const p = parsePitch(`${s}4`);
  return { letter: p.letter, accidental: p.accidental };
}

export function samePitch(a: Pitch, b: Pitch): boolean {
  return a.letter === b.letter && a.accidental === b.accidental && a.octave === b.octave;
}

export function sameSpelledClass(a: Pick<Pitch, 'letter' | 'accidental'>, b: Pick<Pitch, 'letter' | 'accidental'>): boolean {
  return a.letter === b.letter && a.accidental === b.accidental;
}

export function pitchClass(p: Pitch): number {
  return ((midi(p) % 12) + 12) % 12;
}

/** Transpose by whole octaves, keeping the spelling. */
export function shiftOctave(p: Pitch, octaves: number): Pitch {
  return { ...p, octave: p.octave + octaves };
}

/** Default spelling of a MIDI number (sharps or flats preference). */
export function fromMidi(m: number, prefer: 'sharp' | 'flat' = 'sharp'): Pitch {
  const pc = ((m % 12) + 12) % 12;
  const octave = Math.floor(m / 12) - 1;
  const sharpNames: [Letter, Accidental][] = [
    ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
  ];
  const flatNames: [Letter, Accidental][] = [
    ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
  ];
  const [letter, accidental] = (prefer === 'sharp' ? sharpNames : flatNames)[pc];
  return { letter, accidental, octave };
}

export function compareMidi(a: Pitch, b: Pitch): number {
  return midi(a) - midi(b) || diatonicIndex(a) - diatonicIndex(b);
}
