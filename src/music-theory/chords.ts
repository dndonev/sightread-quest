import { DEGREES, type Degree, transpose } from './interval';
import {
  type Pitch,
  type NoteNaming,
  accidentalSymbol,
  displayName,
  midi,
  pitchClass,
  sameSpelledClass,
  SOLFEGE,
} from './pitch';

export type ChordQuality =
  | 'maj' | 'min' | 'dim' | 'aug' | 'sus2' | 'sus4'
  | 'maj7' | 'm7' | '7' | 'm7b5' | 'dim7'
  | 'add9' | '6' | 'm6' | 'm9' | 'maj9' | '9'
  | '11' | 'm11' | '13' | 'maj13'
  | '7b9' | '7#9' | '7#11' | '7b13';

export interface ChordQualityDef {
  quality: ChordQuality;
  /** Full formula as chord degrees from the root. */
  formula: Degree[];
  /** Degrees that may be omitted in practical voicings (5th, 11th in 13ths …). */
  optional?: Degree[];
  /** Suffix as written in chord symbols. */
  symbol: string;
  name: string;
  family: 'major' | 'minor' | 'diminished' | 'augmented' | 'suspended' | 'dominant';
}

export const CHORD_QUALITIES: Record<ChordQuality, ChordQualityDef> = {
  maj: { quality: 'maj', formula: ['1', '3', '5'], symbol: '', name: 'major triad', family: 'major' },
  min: { quality: 'min', formula: ['1', 'b3', '5'], symbol: 'm', name: 'minor triad', family: 'minor' },
  dim: { quality: 'dim', formula: ['1', 'b3', 'b5'], symbol: 'dim', name: 'diminished triad', family: 'diminished' },
  aug: { quality: 'aug', formula: ['1', '3', '#5'], symbol: 'aug', name: 'augmented triad', family: 'augmented' },
  sus2: { quality: 'sus2', formula: ['1', '2', '5'], symbol: 'sus2', name: 'suspended 2nd', family: 'suspended' },
  sus4: { quality: 'sus4', formula: ['1', '4', '5'], symbol: 'sus4', name: 'suspended 4th', family: 'suspended' },
  maj7: { quality: 'maj7', formula: ['1', '3', '5', '7'], symbol: 'maj7', name: 'major 7th', family: 'major' },
  m7: { quality: 'm7', formula: ['1', 'b3', '5', 'b7'], symbol: 'm7', name: 'minor 7th', family: 'minor' },
  '7': { quality: '7', formula: ['1', '3', '5', 'b7'], symbol: '7', name: 'dominant 7th', family: 'dominant' },
  m7b5: { quality: 'm7b5', formula: ['1', 'b3', 'b5', 'b7'], symbol: 'm7♭5', name: 'half-diminished 7th', family: 'diminished' },
  dim7: { quality: 'dim7', formula: ['1', 'b3', 'b5', 'bb7'], symbol: 'dim7', name: 'diminished 7th', family: 'diminished' },
  add9: { quality: 'add9', formula: ['1', '3', '5', '9'], symbol: 'add9', name: 'major add 9', family: 'major' },
  '6': { quality: '6', formula: ['1', '3', '5', '6'], symbol: '6', name: 'major 6th', family: 'major' },
  m6: { quality: 'm6', formula: ['1', 'b3', '5', '6'], symbol: 'm6', name: 'minor 6th', family: 'minor' },
  m9: { quality: 'm9', formula: ['1', 'b3', '5', 'b7', '9'], optional: ['5'], symbol: 'm9', name: 'minor 9th', family: 'minor' },
  maj9: { quality: 'maj9', formula: ['1', '3', '5', '7', '9'], optional: ['5'], symbol: 'maj9', name: 'major 9th', family: 'major' },
  '9': { quality: '9', formula: ['1', '3', '5', 'b7', '9'], optional: ['5'], symbol: '9', name: 'dominant 9th', family: 'dominant' },
  '11': { quality: '11', formula: ['1', '5', 'b7', '9', '11'], symbol: '11', name: 'dominant 11th (no 3rd)', family: 'dominant' },
  m11: { quality: 'm11', formula: ['1', 'b3', '5', 'b7', '9', '11'], optional: ['5', '9'], symbol: 'm11', name: 'minor 11th', family: 'minor' },
  '13': { quality: '13', formula: ['1', '3', 'b7', '9', '13'], optional: ['9'], symbol: '13', name: 'dominant 13th', family: 'dominant' },
  maj13: { quality: 'maj13', formula: ['1', '3', '7', '9', '13'], optional: ['9'], symbol: 'maj13', name: 'major 13th', family: 'major' },
  '7b9': { quality: '7b9', formula: ['1', '3', '5', 'b7', 'b9'], optional: ['5'], symbol: '7♭9', name: 'dominant 7♭9', family: 'dominant' },
  '7#9': { quality: '7#9', formula: ['1', '3', '5', 'b7', '#9'], optional: ['5'], symbol: '7♯9', name: 'dominant 7♯9', family: 'dominant' },
  '7#11': { quality: '7#11', formula: ['1', '3', 'b7', '#11'], symbol: '7♯11', name: 'dominant 7♯11', family: 'dominant' },
  '7b13': { quality: '7b13', formula: ['1', '3', 'b7', 'b13'], symbol: '7♭13', name: 'dominant 7♭13', family: 'dominant' },
};

export type RootClass = Pick<Pitch, 'letter' | 'accidental'>;

export interface ChordSpec {
  root: RootClass;
  quality: ChordQuality;
  /** Degree in the bass. '1' = root position. */
  bass: Degree;
}

export interface ChordTone {
  degree: Degree;
  pitch: Pitch;
}

/** Spelled chord tones (one per degree) built on the root in a given octave. */
export function chordTones(root: RootClass, quality: ChordQuality, octave = 4): ChordTone[] {
  const r: Pitch = { ...root, octave };
  return CHORD_QUALITIES[quality].formula.map((d) => ({ degree: d, pitch: transpose(r, DEGREES[d]) }));
}

export function chordPitchClassSet(root: RootClass, quality: ChordQuality): number[] {
  return [...new Set(chordTones(root, quality).map((t) => pitchClass(t.pitch)))].sort((a, b) => a - b);
}

/** Inversion number for a bass degree (0 = root position). */
export function inversionOf(quality: ChordQuality, bass: Degree): number {
  if (bass === '1') return 0;
  if (!CHORD_QUALITIES[quality].formula.includes(bass)) throw new Error(`${bass} is not in ${quality}`);
  // Inversion is defined by stacked-thirds position: 3rd → 1st, 5th → 2nd, 7th → 3rd
  const thirdLike = ['b3', '3', '2', '4'];
  const fifthLike = ['b5', '5', '#5'];
  const seventhLike = ['bb7', 'b7', '7', '6'];
  if (thirdLike.includes(bass)) return 1;
  if (fifthLike.includes(bass)) return 2;
  if (seventhLike.includes(bass)) return 3;
  return 4;
}

export const INVERSION_NAMES = ['Root position', '1st inversion', '2nd inversion', '3rd inversion', 'Upper-extension bass'];

export function bassTone(spec: ChordSpec): Pitch {
  return transpose({ ...spec.root, octave: 4 }, DEGREES[spec.bass]);
}

function rootLabel(root: RootClass, naming: NoteNaming): string {
  return naming === 'solfege' ? `${SOLFEGE[root.letter]}${accidentalSymbol(root.accidental)}` : displayName(root);
}

/** Chord symbol such as "Cmaj7", "F♯m7♭5", "B♭/D". */
export function chordSymbol(spec: ChordSpec, naming: NoteNaming = 'english'): string {
  const base = rootLabel(spec.root, naming) + CHORD_QUALITIES[spec.quality].symbol;
  if (spec.bass === '1') return base;
  return `${base}/${rootLabel(bassTone(spec), naming)}`;
}

/** Identity used to decide whether two chord readings are the same answer. */
export function chordKey(spec: ChordSpec): string {
  const b = bassTone(spec);
  return `${spec.root.letter}${spec.root.accidental}:${spec.quality}:${b.letter}${b.accidental}`;
}

/**
 * Two readings are indistinguishable from the notes alone when they contain the
 * same pitch classes over the same bass (e.g. C6 vs Am7/C, Csus2 vs Gsus4/C).
 * Such pairs must never appear together as answer options.
 */
export function enharmonicallyAmbiguous(a: ChordSpec, b: ChordSpec): boolean {
  const setA = chordPitchClassSet(a.root, a.quality).join(',');
  const setB = chordPitchClassSet(b.root, b.quality).join(',');
  return setA === setB && pitchClass(bassTone(a)) === pitchClass(bassTone(b));
}

export function chordHasDoubleAccidental(root: RootClass, quality: ChordQuality): boolean {
  return chordTones(root, quality).some((t) => Math.abs(t.pitch.accidental) === 2 && !(quality === 'dim7' && t.degree === 'bb7'));
}

/**
 * Identify a chord from spelled pitches by trying every chord tone as a root.
 * Returns every reading whose formula exactly matches the spelled pitch-class content.
 */
export function identifyChord(pitches: Pitch[], allowed: ChordQuality[] = Object.keys(CHORD_QUALITIES) as ChordQuality[]): ChordSpec[] {
  if (pitches.length === 0) return [];
  const sorted = [...pitches].sort((a, b) => midi(a) - midi(b));
  const lowest = sorted[0];
  const classes: RootClass[] = [];
  for (const p of sorted) if (!classes.some((c) => sameSpelledClass(c, p))) classes.push({ letter: p.letter, accidental: p.accidental });
  const results: ChordSpec[] = [];
  for (const root of classes) {
    for (const q of allowed) {
      const def = CHORD_QUALITIES[q];
      let tones: ChordTone[];
      try {
        tones = chordTones(root, q);
      } catch {
        continue; // unspellable from this root (would need triple accidentals)
      }
      const required = tones.filter((t) => !(def.optional ?? []).includes(t.degree));
      const allPresent = required.every((t) => classes.some((c) => sameSpelledClass(c, t.pitch)));
      const noExtras = classes.every((c) => tones.some((t) => sameSpelledClass(c, t.pitch)));
      if (allPresent && noExtras) {
        const bassDeg = tones.find((t) => sameSpelledClass(t.pitch, lowest))!.degree;
        results.push({ root, quality: q, bass: bassDeg });
      }
    }
  }
  return results;
}
