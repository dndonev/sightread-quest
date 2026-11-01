import { type Accidental, type Letter, type Pitch, LETTERS, pitchClassString } from './pitch';
import { DEGREES, transpose } from './interval';

export type Mode = 'major' | 'minor';

export interface KeySignature {
  /** Number of sharps (positive) or flats (negative), -7..7 */
  fifths: number;
}

export interface Key {
  tonic: Pick<Pitch, 'letter' | 'accidental'>;
  mode: Mode;
  fifths: number;
}

const SHARP_ORDER: Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: Letter[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Major key tonics by number of fifths, -7..7 */
const MAJOR_BY_FIFTHS: Record<number, string> = {
  [-7]: 'Cb', [-6]: 'Gb', [-5]: 'Db', [-4]: 'Ab', [-3]: 'Eb', [-2]: 'Bb', [-1]: 'F', 0: 'C',
  1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#',
};
const MINOR_BY_FIFTHS: Record<number, string> = {
  [-7]: 'Ab', [-6]: 'Eb', [-5]: 'Bb', [-4]: 'F', [-3]: 'C', [-2]: 'G', [-1]: 'D', 0: 'A',
  1: 'E', 2: 'B', 3: 'F#', 4: 'C#', 5: 'G#', 6: 'D#', 7: 'A#',
};

function parseTonic(s: string): Pick<Pitch, 'letter' | 'accidental'> {
  const letter = s[0] as Letter;
  const rest = s.slice(1);
  const accidental = (rest === '#' ? 1 : rest === 'b' ? -1 : 0) as Accidental;
  return { letter, accidental };
}

export function keyFromFifths(fifths: number, mode: Mode = 'major'): Key {
  const name = (mode === 'major' ? MAJOR_BY_FIFTHS : MINOR_BY_FIFTHS)[fifths];
  if (!name) throw new Error(`Invalid fifths ${fifths}`);
  return { tonic: parseTonic(name), mode, fifths };
}

export function keyAccidentals(fifths: number): Record<Letter, Accidental> {
  const map = Object.fromEntries(LETTERS.map((l) => [l, 0])) as Record<Letter, Accidental>;
  if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach((l) => (map[l] = 1));
  if (fifths < 0) FLAT_ORDER.slice(0, -fifths).forEach((l) => (map[l] = -1));
  return map;
}

/** Letters altered by the key signature, in the order they are written. */
export function keySignatureLetters(fifths: number): Letter[] {
  return fifths >= 0 ? SHARP_ORDER.slice(0, fifths) : FLAT_ORDER.slice(0, -fifths);
}

/** VexFlow key spec, e.g. "Bb", "F#m" */
export function vexKeySpec(key: Key): string {
  return pitchClassString(key.tonic) + (key.mode === 'minor' ? 'm' : '');
}

export function keyName(key: Key): string {
  const acc = key.tonic.accidental === 1 ? '♯' : key.tonic.accidental === -1 ? '♭' : '';
  return `${key.tonic.letter}${acc} ${key.mode}`;
}

export type ScaleType = 'major' | 'natural-minor' | 'harmonic-minor';

const SCALE_DEGREES: Record<ScaleType, (keyof typeof DEGREES)[]> = {
  major: ['1', '2', '3', '4', '5', '6', '7'],
  'natural-minor': ['1', '2', 'b3', '4', '5', 'b6', 'b7'],
  'harmonic-minor': ['1', '2', 'b3', '4', '5', 'b6', '7'],
};

/** Spelled scale starting at the tonic in the given octave. */
export function scale(tonic: Pick<Pitch, 'letter' | 'accidental'>, type: ScaleType, octave = 4): Pitch[] {
  const root: Pitch = { ...tonic, octave };
  return SCALE_DEGREES[type].map((d) => transpose(root, DEGREES[d]));
}

/**
 * Tracks accidentals within one measure, following standard engraving rules:
 * an accidental applies to the same letter *and octave* until the barline.
 */
export class MeasureAccidentalState {
  private readonly keyMap: Record<Letter, Accidental>;
  private readonly active = new Map<string, Accidental>();

  constructor(fifths: number) {
    this.keyMap = keyAccidentals(fifths);
  }

  private slot(letter: Letter, octave: number) {
    return `${letter}${octave}`;
  }

  /** The accidental a plain (unmarked) notehead on this line/space currently means. */
  implied(letter: Letter, octave: number): Accidental {
    return this.active.get(this.slot(letter, octave)) ?? this.keyMap[letter];
  }

  /**
   * Returns the accidental sign that must be printed for this pitch
   * (null when none is needed) and records its effect for the rest of the measure.
   */
  displayFor(p: Pitch): Accidental | null {
    const implied = this.implied(p.letter, p.octave);
    if (implied === p.accidental) return null;
    this.active.set(this.slot(p.letter, p.octave), p.accidental);
    return p.accidental;
  }

  /** Apply an explicitly printed accidental (when reading, not writing). */
  applyPrinted(letter: Letter, octave: number, printed: Accidental | null): Accidental {
    if (printed !== null) this.active.set(this.slot(letter, octave), printed);
    return this.implied(letter, octave);
  }
}
