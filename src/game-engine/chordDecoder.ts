import {
  CHORD_QUALITIES,
  type ChordQuality,
  type ChordSpec,
  type RootClass,
  INVERSION_NAMES,
  chordHasDoubleAccidental,
  chordKey,
  chordSymbol,
  chordTones,
  enharmonicallyAmbiguous,
  identifyChord,
  inversionOf,
} from '../music-theory/chords';
import { type Degree, intervalBetween, intervalLongName, intervalName } from '../music-theory/interval';
import { type Accidental, type NoteNaming, type Pitch, displayName, midi, pitchClass, sameSpelledClass, shiftOctave } from '../music-theory/pitch';
import { type Key, keyFromFifths, keyName, scale } from '../music-theory/keys';
import { type Fingering, findChordFingering } from '../music-theory/guitar';
import type { Rng } from '../music-theory/random';
import { type ItemStat, pickWeighted } from '../adaptive-learning/mastery';
import type { Instrument } from '../persistence/types';

export type ChordMode = 'name' | 'components' | 'missing' | 'interval' | 'fretboard' | 'hear' | 'progression';

export const CHORD_MODES: { id: ChordMode; title: string; description: string; guitarOnly?: boolean }[] = [
  { id: 'name', title: 'Name the chord', description: 'Pick the chord symbol for the written notes.' },
  { id: 'components', title: 'Root · Quality · Inversion', description: 'Identify each part separately.' },
  { id: 'missing', title: 'Missing tone', description: 'One chord tone is left out — which one?' },
  { id: 'interval', title: 'Intervals', description: 'Name the interval from the lowest to the highest note.' },
  { id: 'fretboard', title: 'Staff → fretboard', description: 'Match the written chord to a fingering.', guitarOnly: true },
  { id: 'hear', title: 'Ear → staff', description: 'Hear a chord and find its notation.' },
  { id: 'progression', title: 'Progressions', description: 'Recognise ii–V–I, secondary dominants and more.' },
];

export interface ChordLevel {
  level: number;
  title: string;
  description: string;
  qualities: ChordQuality[];
  inversions: boolean;
  /** Probability of an open (drop-2 / spread) voicing. */
  openRate: number;
  rootless?: boolean;
}

export const CHORD_LEVELS: ChordLevel[] = [
  { level: 1, title: 'Major & minor', description: 'Root-position major and minor triads.', qualities: ['maj', 'min'], inversions: false, openRate: 0 },
  { level: 2, title: 'Dim & aug', description: 'Adds diminished and augmented triads.', qualities: ['maj', 'min', 'dim', 'aug'], inversions: false, openRate: 0 },
  { level: 3, title: 'Suspended', description: 'Adds sus2 and sus4.', qualities: ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4'], inversions: false, openRate: 0.15 },
  { level: 4, title: 'Seventh chords', description: 'maj7, m7 and dominant 7.', qualities: ['maj7', 'm7', '7'], inversions: false, openRate: 0.3 },
  { level: 5, title: 'Diminished sevenths', description: 'Adds m7♭5 and dim7.', qualities: ['maj7', 'm7', '7', 'm7b5', 'dim7'], inversions: false, openRate: 0.3 },
  { level: 6, title: 'Inversions', description: 'Triads and sevenths in every inversion — read the bass.', qualities: ['maj', 'min', 'dim', 'maj7', 'm7', '7', 'm7b5'], inversions: true, openRate: 0.2 },
  { level: 7, title: 'Colour tones', description: 'add9, 6, m6, m9, maj9, 9.', qualities: ['add9', '6', 'm6', 'm9', 'maj9', '9'], inversions: false, openRate: 0.35 },
  { level: 8, title: '11ths & 13ths', description: '11, m11, 13, maj13 (with typical omissions).', qualities: ['9', 'm9', '11', 'm11', '13', 'maj13'], inversions: false, openRate: 0.4 },
  { level: 9, title: 'Altered dominants', description: '7♭9, 7♯9, 7♯11, 7♭13.', qualities: ['7', '7b9', '7#9', '7#11', '7b13'], inversions: false, openRate: 0.35 },
  { level: 10, title: 'Rootless voicings', description: 'Jazz voicings without the root — use the harmonic context.', qualities: ['m9', '9', 'maj9', '13', 'm7b5'], inversions: false, openRate: 0.3, rootless: true },
];

export function chordLevel(level: number): ChordLevel {
  return CHORD_LEVELS[Math.max(0, Math.min(CHORD_LEVELS.length - 1, level - 1))];
}

const ROOTS_SHARP_FRIENDLY: RootClass[] = [
  { letter: 'C', accidental: 0 }, { letter: 'C', accidental: 1 }, { letter: 'D', accidental: 0 }, { letter: 'E', accidental: -1 },
  { letter: 'E', accidental: 0 }, { letter: 'F', accidental: 0 }, { letter: 'F', accidental: 1 }, { letter: 'G', accidental: 0 },
  { letter: 'G', accidental: 1 }, { letter: 'A', accidental: 0 }, { letter: 'B', accidental: -1 }, { letter: 'B', accidental: 0 },
];
const ROOTS_FLAT_FRIENDLY: RootClass[] = [
  { letter: 'C', accidental: 0 }, { letter: 'D', accidental: -1 }, { letter: 'D', accidental: 0 }, { letter: 'E', accidental: -1 },
  { letter: 'E', accidental: 0 }, { letter: 'F', accidental: 0 }, { letter: 'F', accidental: 1 }, { letter: 'G', accidental: 0 },
  { letter: 'A', accidental: -1 }, { letter: 'A', accidental: 0 }, { letter: 'B', accidental: -1 }, { letter: 'B', accidental: 0 },
];

/** Roots conventionally used for each family (all 12 chromatic roots are covered). */
export function rootsFor(q: ChordQuality): RootClass[] {
  const fam = CHORD_QUALITIES[q].family;
  return fam === 'minor' || fam === 'diminished' ? ROOTS_SHARP_FRIENDLY : ROOTS_FLAT_FRIENDLY;
}

/* ---------------- Voicings ---------------- */

export type VoicingKind = 'close' | 'open';

export interface VoicedNote {
  degree: Degree;
  /** Written pitch (guitar: one octave above sounding). */
  pitch: Pitch;
}

export interface Voicing {
  spec: ChordSpec;
  notes: VoicedNote[];
  /** Sounding MIDI numbers, ascending. */
  sounding: number[];
  fingering: Fingering | null;
  rootless: boolean;
  kind: VoicingKind;
  /** piano open voicings go on a grand staff */
  staff: 'treble' | 'grand';
}

function stackAbove(prev: Pitch, p: Pitch): Pitch {
  let q = { ...p, octave: prev.octave - 1 };
  while (midi(q) <= midi(prev)) q = shiftOctave(q, 1);
  return q;
}

function rotateFormula(formula: Degree[], bass: Degree): Degree[] {
  const i = formula.indexOf(bass);
  return [...formula.slice(i), ...formula.slice(0, i)];
}

export interface VoicingOptions {
  kind: VoicingKind;
  rootless?: boolean;
  /** Max notes; optional degrees are removed to fit. */
  maxNotes?: number;
}

/**
 * Build a concrete voicing. The returned spec's bass is derived from the
 * actual lowest note, so the answer always matches what's on the staff.
 */
export function buildVoicing(spec: ChordSpec, instrument: Instrument, rng: Rng, opts: VoicingOptions): Voicing | null {
  const def = CHORD_QUALITIES[spec.quality];
  let tones = chordTones(spec.root, spec.quality, 4);
  if (opts.rootless) tones = tones.filter((t) => t.degree !== '1');
  const maxNotes = opts.maxNotes ?? (instrument === 'guitar' ? 4 : 5);
  const optional = rng.shuffle(def.optional ?? []);
  while (tones.length > maxNotes && optional.length) {
    const drop = optional.pop()!;
    tones = tones.filter((t) => t.degree !== drop);
  }
  if (tones.length > maxNotes + 1) return null;
  const degrees = tones.map((t) => t.degree);
  const pitchOf = (d: Degree) => tones.find((t) => t.degree === d)!.pitch;

  // Rootless voicings conventionally start on the 3rd or 7th.
  let bass: Degree = spec.bass;
  if (opts.rootless) bass = rng.pick(degrees.filter((d) => ['3', 'b3', 'b7', '7'].includes(d))) ?? degrees[0];
  if (!degrees.includes(bass)) bass = degrees[0];

  const order = rotateFormula(degrees, bass);
  let notes: VoicedNote[] = [];
  for (const d of order) {
    const p = pitchOf(d);
    notes.push({ degree: d, pitch: notes.length ? stackAbove(notes[notes.length - 1].pitch, p) : p });
  }
  if (opts.kind === 'open') {
    if (notes.length >= 4) {
      // Drop-2: second-highest voice down an octave.
      const i = notes.length - 2;
      notes[i] = { ...notes[i], pitch: shiftOctave(notes[i].pitch, -1) };
    } else if (notes.length === 3) {
      // Spread triad: middle voice up an octave.
      notes[1] = { ...notes[1], pitch: shiftOctave(notes[1].pitch, 1) };
    }
    notes.sort((a, b) => midi(a.pitch) - midi(b.pitch));
  }

  const place = (lowMin: number, lowMax: number) => {
    let shift = 0;
    const low = midi(notes[0].pitch);
    while (low + 12 * shift < lowMin) shift++;
    while (low + 12 * shift > lowMax) shift--;
    notes = notes.map((n) => ({ ...n, pitch: shiftOctave(n.pitch, shift) }));
  };

  let fingering: Fingering | null = null;
  let sounding: number[];
  let staff: Voicing['staff'] = 'treble';
  if (instrument === 'guitar') {
    // Work in sounding pitch, then write one octave up.
    const windows: [number, number][] = opts.kind === 'open' ? [[40, 52], [45, 57], [50, 62]] : [[48, 59], [52, 64], [45, 55]];
    let found = false;
    for (const [lo, hi] of windows) {
      place(lo + 12, hi + 12); // place written
      sounding = notes.map((n) => midi(n.pitch) - 12);
      fingering = findChordFingering(sounding);
      if (fingering) {
        found = true;
        break;
      }
    }
    if (!found) return null;
    sounding = notes.map((n) => midi(n.pitch) - 12);
  } else {
    if (opts.kind === 'open') {
      place(43, 55);
      staff = 'grand';
    } else {
      place(59, 66);
    }
    sounding = notes.map((n) => midi(n.pitch));
  }
  const actualSpec: ChordSpec = { ...spec, bass: opts.rootless ? '1' : notes[0].degree };
  return { spec: actualSpec, notes, sounding: sounding!, fingering, rootless: !!opts.rootless, kind: opts.kind, staff };
}

/* ---------------- Questions ---------------- */

export interface ChordOption {
  label: string;
  spec?: ChordSpec;
  voicing?: Voicing;
}

export interface ProgressionData {
  key: Key;
  chords: Voicing[];
  labels: string[];
}

export interface ChordQuestion {
  id: string;
  mode: ChordMode;
  level: number;
  /** Voicing to render (for 'missing' this is the incomplete chord). */
  voicing: Voicing;
  answer: ChordSpec;
  prompt: string;
  context?: string;
  options: ChordOption[];
  correctIndex: number;
  components?: { roots: RootClass[]; qualities: ChordQuality[]; inversions: number[]; answerInversion: number };
  progression?: ProgressionData;
  itemKey: string;
  explanation: string;
}

export interface ChordConfig {
  level: number;
  mode: ChordMode;
  instrument: Instrument;
  naming: NoteNaming;
}

let qid = 0;

interface Candidate {
  quality: ChordQuality;
  inversion: number;
}

function candidatesFor(lvl: ChordLevel): Candidate[] {
  const out: Candidate[] = [];
  for (const q of lvl.qualities) {
    if (!lvl.inversions) out.push({ quality: q, inversion: 0 });
    else {
      const n = CHORD_QUALITIES[q].formula.length;
      for (let inv = 0; inv < Math.min(n, 4); inv++) out.push({ quality: q, inversion: inv });
    }
  }
  return out;
}

function bassDegreeForInversion(q: ChordQuality, inversion: number): Degree {
  const f = CHORD_QUALITIES[q].formula;
  return f[Math.min(inversion, f.length - 1)];
}

export function chordItemKey(q: ChordQuality, inversion: number): string {
  return inversion ? `chord:${q}:inv${inversion}` : `chord:${q}`;
}

function randomSpec(rng: Rng, c: Candidate): ChordSpec | null {
  for (let i = 0; i < 20; i++) {
    const root = rng.pick(rootsFor(c.quality));
    if (chordHasDoubleAccidental(root, c.quality)) continue;
    return { root, quality: c.quality, bass: bassDegreeForInversion(c.quality, c.inversion) };
  }
  return null;
}

export function displayedPitches(v: Voicing): Pitch[] {
  return v.notes.map((n) => n.pitch);
}

/**
 * Whether a distractor is a *wrong* answer: it must not be another valid reading
 * of the displayed notes (same notes, same bass) and must differ from the answer.
 */
export function isValidDistractor(answer: ChordSpec, d: ChordSpec, shown: Pitch[], pool: ChordQuality[]): boolean {
  if (chordKey(answer) === chordKey(d)) return false;
  if (enharmonicallyAmbiguous(answer, d)) return false;
  if (chordHasDoubleAccidental(d.root, d.quality)) return false;
  const readings = identifyChord(shown, [...new Set([...pool, answer.quality, d.quality])]);
  if (readings.some((r) => chordKey(r) === chordKey(d))) return false;
  return true;
}

function shiftRoot(root: RootClass, semis: number, prefer: 'sharp' | 'flat'): RootClass {
  const pc = (((pitchClass({ ...root, octave: 4 }) + semis) % 12) + 12) % 12;
  const list = prefer === 'sharp' ? ROOTS_SHARP_FRIENDLY : ROOTS_FLAT_FRIENDLY;
  return list.find((r) => pitchClass({ ...r, octave: 4 }) === pc)!;
}

function distractorSpecs(answer: ChordSpec, shown: Pitch[], lvl: ChordLevel, rng: Rng, count = 3): ChordSpec[] {
  const pool = lvl.qualities;
  const cands: ChordSpec[] = [];
  const bassAs = (q: ChordQuality, inv: number): Degree => (lvl.inversions ? bassDegreeForInversion(q, inv) : '1');
  const ansInv = inversionOf(answer.quality, answer.bass);
  // 1. same root, other quality (keep inversion number)
  for (const q of rng.shuffle(pool)) cands.push({ root: answer.root, quality: q, bass: bassAs(q, ansInv) });
  // 2. lowest-note-as-root trap
  if (answer.bass !== '1') {
    const low = shown[0];
    for (const q of rng.shuffle(pool)) cands.push({ root: { letter: low.letter, accidental: low.accidental }, quality: q, bass: '1' });
  }
  // 3. same chord, other inversions
  if (lvl.inversions) {
    const n = Math.min(4, CHORD_QUALITIES[answer.quality].formula.length);
    for (let inv = 0; inv < n; inv++) cands.push({ ...answer, bass: bassDegreeForInversion(answer.quality, inv) });
  }
  // 4. same quality, neighbouring / third-related roots
  const pref = CHORD_QUALITIES[answer.quality].family === 'minor' ? 'sharp' : 'flat';
  for (const s of rng.shuffle([1, -1, 2, -2, 3, 4, -3, 5, 7])) cands.push({ ...answer, root: shiftRoot(answer.root, s, pref) });

  const out: ChordSpec[] = [];
  const seenLabels = new Set([chordSymbol(answer)]);
  // Prefer a mix: shuffle within the priority order lightly.
  for (const c of cands) {
    if (out.length >= count) break;
    if (!CHORD_QUALITIES[c.quality].formula.includes(c.bass)) continue;
    const label = chordSymbol(c);
    if (seenLabels.has(label)) continue;
    if (!isValidDistractor(answer, c, shown, pool)) continue;
    if (out.some((o) => enharmonicallyAmbiguous(o, c))) continue;
    seenLabels.add(label);
    out.push(c);
  }
  return rng.shuffle(out);
}

export function generateChordQuestion(
  cfg: ChordConfig,
  rng: Rng,
  stats: Record<string, ItemStat> = {},
  now = Date.now(),
  options: { previousKey?: string; weakOnly?: boolean } = {},
): ChordQuestion {
  if (cfg.mode === 'progression') return generateProgressionQuestion(cfg, rng);
  const lvl = chordLevel(cfg.level);
  const cands = candidatesFor(lvl);
  for (let attempt = 0; attempt < 60; attempt++) {
    const c = pickWeighted(rng, cands, (x) => chordItemKey(x.quality, x.inversion), stats, now, {
      avoidKey: attempt < 30 ? options.previousKey : undefined,
      weakOnly: options.weakOnly,
      targetMs: 4000,
    });
    const spec = randomSpec(rng, c);
    if (!spec) continue;
    const kind: VoicingKind = !lvl.inversions && rng.chance(lvl.openRate) ? 'open' : 'close';
    const rootless = !!lvl.rootless && cfg.mode !== 'missing' && c.quality !== 'm7b5';
    const voicing = buildVoicing(spec, cfg.instrument, rng, { kind, rootless });
    if (!voicing) continue;
    const answer = voicing.spec;
    const shown = displayedPitches(voicing);
    // The notes must not support another reading from this level's pool (unless rootless with context).
    if (!rootless) {
      const readings = identifyChord(shown, lvl.qualities);
      if (readings.some((r) => chordKey(r) !== chordKey(answer))) continue;
      if (!readings.some((r) => chordKey(r) === chordKey(answer))) continue;
    }
    const itemKey = chordItemKey(answer.quality, inversionOf(answer.quality, answer.bass));
    const q = buildModeQuestion(cfg, lvl, rng, voicing, answer, itemKey);
    if (q) return q;
  }
  throw new Error('Could not generate chord question');
}

function rootlessContext(answer: ChordSpec): string {
  const r = displayName(answer.root);
  const q = answer.quality;
  if (q === 'm9') return `Context: ii chord of a ii–V–I (the bass player plays ${r}).`;
  if (q === '9' || q === '13') return `Context: V chord resolving to I (the bass player plays ${r}).`;
  if (q === 'maj9') return `Context: tonic I chord (the bass player plays ${r}).`;
  return `Context: ii chord of a minor ii–V–i (the bass player plays ${r}).`;
}

function buildModeQuestion(cfg: ChordConfig, lvl: ChordLevel, rng: Rng, voicing: Voicing, answer: ChordSpec, itemKey: string): ChordQuestion | null {
  const n = cfg.naming;
  const shown = displayedPitches(voicing);
  const symbol = chordSymbol(answer, n);
  const tonesText = voicing.notes.map((x) => `${displayName(x.pitch, n)} (${x.degree === '1' ? 'R' : x.degree})`).join(', ');
  const inv = inversionOf(answer.quality, answer.bass);
  const baseExplanation = `${symbol}: ${tonesText}. ${CHORD_QUALITIES[answer.quality].name}${lvl.inversions || inv ? `, ${INVERSION_NAMES[inv].toLowerCase()}` : ''}.`;
  const context = voicing.rootless ? rootlessContext(answer) : undefined;
  const common = { id: `cq${++qid}`, level: cfg.level, voicing, answer, context, itemKey };

  switch (cfg.mode) {
    case 'name':
    case 'hear':
    case 'fretboard': {
      const distractors = distractorSpecs(answer, shown, lvl, rng);
      if (distractors.length < 3) return null;
      let opts: ChordOption[] = [{ label: symbol, spec: answer, voicing }];
      for (const d of distractors) {
        if (cfg.mode === 'name') opts.push({ label: chordSymbol(d, n), spec: d });
        else {
          const v = buildVoicing(d, cfg.instrument, rng, { kind: voicing.kind, rootless: voicing.rootless });
          if (!v) return null;
          const label = chordSymbol(v.spec, n);
          if (opts.some((o) => o.label === label || (o.spec && enharmonicallyAmbiguous(o.spec, v.spec)))) return null;
          opts.push({ label, spec: v.spec, voicing: v });
        }
      }
      opts = rng.shuffle(opts);
      const prompt =
        cfg.mode === 'name' ? 'Name this chord' : cfg.mode === 'hear' ? 'Listen, then pick the matching notation' : 'Which fingering plays this written chord?';
      return { ...common, mode: cfg.mode, prompt, options: opts, correctIndex: opts.findIndex((o) => o.spec && chordKey(o.spec) === chordKey(answer)), explanation: baseExplanation };
    }
    case 'components': {
      const pool = lvl.qualities.length >= 4 ? lvl.qualities : [...new Set([...lvl.qualities, 'maj', 'min', 'dim', 'aug'] as ChordQuality[])];
      const qualities = rng.shuffle([answer.quality, ...rng.shuffle(pool.filter((q) => q !== answer.quality)).slice(0, 3)]);
      const rootCands: RootClass[] = [shown[0], ...shown.slice(1)].map((p) => ({ letter: p.letter, accidental: p.accidental }));
      const roots: RootClass[] = [answer.root];
      for (const r of [...rootCands, shiftRoot(answer.root, 1, 'flat'), shiftRoot(answer.root, -1, 'sharp')]) {
        if (roots.length >= 4) break;
        if (!roots.some((x) => sameSpelledClass(x, r))) roots.push(r);
      }
      const nInv = lvl.inversions ? Math.min(4, CHORD_QUALITIES[answer.quality].formula.length) : 1;
      return {
        ...common,
        mode: 'components',
        prompt: lvl.inversions ? 'Identify the root, quality and inversion' : 'Identify the root and quality',
        options: [],
        correctIndex: -1,
        components: { roots: rng.shuffle(roots), qualities, inversions: Array.from({ length: nInv }, (_, i) => i), answerInversion: inv },
        explanation: baseExplanation,
      };
    }
    case 'missing': {
      if (voicing.rootless) return null;
      const def = CHORD_QUALITIES[answer.quality];
      const required = voicing.notes.filter((x) => x.degree !== '1' && !(def.optional ?? []).includes(x.degree) && x !== voicing.notes[0]);
      if (!required.length || voicing.notes.length < 3) return null;
      const removed = rng.pick(required);
      const remaining = voicing.notes.filter((x) => x !== removed);
      const shownVoicing: Voicing = {
        ...voicing,
        notes: remaining,
        sounding: voicing.sounding.filter((_, i) => voicing.notes[i] !== removed),
        fingering: null,
      };
      const missing = removed.pitch;
      const present = remaining.map((x) => x.pitch);
      const alt = (a: number): Pitch | null => (Math.abs(missing.accidental + a) <= 1 ? { ...missing, accidental: (missing.accidental + a) as Accidental } : null);
      const distract: Pitch[] = [];
      for (const p of [alt(-1), alt(1), { ...missing, letter: nextLetter(missing.letter, 1), accidental: 0 as Accidental }, { ...missing, letter: nextLetter(missing.letter, -1), accidental: 0 as Accidental }]) {
        if (!p) continue;
        if (present.some((x) => pitchClass(x) === pitchClass(p))) continue;
        if (pitchClass(p) === pitchClass(missing)) continue;
        if (distract.some((x) => pitchClass(x) === pitchClass(p))) continue;
        distract.push(p);
      }
      if (distract.length < 3) return null;
      let opts: ChordOption[] = [missing, ...distract.slice(0, 3)].map((p) => ({ label: displayName(p, n) }));
      const correctLabel = opts[0].label;
      opts = rng.shuffle(opts);
      return {
        ...common,
        voicing: shownVoicing,
        mode: 'missing',
        prompt: `This should be ${symbol}. Which chord tone is missing?`,
        options: opts,
        correctIndex: opts.findIndex((o) => o.label === correctLabel),
        explanation: `${symbol} needs its ${removed.degree === '3' || removed.degree === 'b3' ? '3rd' : removed.degree} — ${displayName(missing, n)}. Full chord: ${tonesText}.`,
      };
    }
    case 'interval': {
      const low = shown[0];
      const high = shown[shown.length - 1];
      const iv = intervalBetween(low, high);
      const correct = intervalName(iv);
      const names = new Set<string>();
      for (const ds of [0, -1, 1]) for (const dz of [-1, 1, -2, 2, 0]) {
        if (ds === 0 && dz === 0) continue;
        const nm = intervalName({ steps: iv.steps + ds, semitones: iv.semitones + dz });
        if (/^(AA|dd)/.test(nm) || nm === correct) continue;
        if (iv.steps + ds < 1) continue;
        names.add(nm);
      }
      const picks = rng.shuffle([...names]).slice(0, 3);
      if (picks.length < 3) return null;
      const opts = rng.shuffle([correct, ...picks]).map((label) => ({ label }));
      return {
        ...common,
        mode: 'interval',
        prompt: 'Interval from the lowest to the highest note?',
        options: opts,
        correctIndex: opts.findIndex((o) => o.label === correct),
        itemKey: `interval:${correct}`,
        explanation: `${displayName(low, n, true)} up to ${displayName(high, n, true)} is a ${intervalLongName(iv)} (${correct}): ${iv.steps + 1} letter names, ${iv.semitones} semitones.`,
      };
    }
  }
  return null;
}

function nextLetter(l: Pitch['letter'], step: number): Pitch['letter'] {
  const L = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
  return L[(L.indexOf(l) + step + 7) % 7];
}

/* ---------------- Progressions ---------------- */

type ProgStep = [degree: number, raise: 0 | 1, quality: ChordQuality, label: string];

export const PROGRESSIONS: { id: string; label: string; steps: ProgStep[]; minLevel: number }[] = [
  { id: 'I-IV-V-I', label: 'I – IV – V⁷ – I', minLevel: 1, steps: [[0, 0, 'maj', 'I'], [3, 0, 'maj', 'IV'], [4, 0, '7', 'V⁷'], [0, 0, 'maj', 'I']] },
  { id: 'I-vi-IV-V', label: 'I – vi – IV – V', minLevel: 1, steps: [[0, 0, 'maj', 'I'], [5, 0, 'min', 'vi'], [3, 0, 'maj', 'IV'], [4, 0, 'maj', 'V']] },
  { id: 'ii-V-I', label: 'ii⁷ – V⁷ – Imaj⁷', minLevel: 4, steps: [[1, 0, 'm7', 'ii⁷'], [4, 0, '7', 'V⁷'], [0, 0, 'maj7', 'Imaj⁷']] },
  { id: 'I-vi-ii-V', label: 'Imaj⁷ – vi⁷ – ii⁷ – V⁷', minLevel: 4, steps: [[0, 0, 'maj7', 'Imaj⁷'], [5, 0, 'm7', 'vi⁷'], [1, 0, 'm7', 'ii⁷'], [4, 0, '7', 'V⁷']] },
  { id: 'iii-vi-ii-V', label: 'iii⁷ – vi⁷ – ii⁷ – V⁷', minLevel: 4, steps: [[2, 0, 'm7', 'iii⁷'], [5, 0, 'm7', 'vi⁷'], [1, 0, 'm7', 'ii⁷'], [4, 0, '7', 'V⁷']] },
  { id: 'I-V/V-V-I', label: 'I – V⁷/V – V⁷ – I', minLevel: 4, steps: [[0, 0, 'maj', 'I'], [1, 0, '7', 'V⁷/V'], [4, 0, '7', 'V⁷'], [0, 0, 'maj', 'I']] },
  { id: 'I-V/vi-vi-IV', label: 'I – V⁷/vi – vi – IV', minLevel: 4, steps: [[0, 0, 'maj', 'I'], [2, 0, '7', 'V⁷/vi'], [5, 0, 'min', 'vi'], [3, 0, 'maj', 'IV']] },
  { id: 'I-#io7-ii-V', label: 'Imaj⁷ – ♯i°⁷ – ii⁷ – V⁷', minLevel: 5, steps: [[0, 0, 'maj7', 'Imaj⁷'], [0, 1, 'dim7', '♯i°⁷'], [1, 0, 'm7', 'ii⁷'], [4, 0, '7', 'V⁷']] },
];

function voiceLead(specs: ChordSpec[], instrument: Instrument, rng: Rng): Voicing[] | null {
  const out: Voicing[] = [];
  for (const spec of specs) {
    const n = CHORD_QUALITIES[spec.quality].formula.length;
    const options: Voicing[] = [];
    for (let inv = 0; inv < n; inv++) {
      const v = buildVoicing({ ...spec, bass: CHORD_QUALITIES[spec.quality].formula[inv] }, instrument, rng, { kind: 'close', maxNotes: 4 });
      if (v) options.push(v);
    }
    if (!options.length) return null;
    const prev = out[out.length - 1];
    const cost = (v: Voicing) => {
      if (!prev) return Math.abs(inversionOf(v.spec.quality, v.spec.bass)) * 10 + Math.abs(v.sounding[0] - (instrument === 'guitar' ? 48 : 60));
      const a = prev.sounding;
      const b = v.sounding;
      let c = 0;
      for (let i = 0; i < Math.max(a.length, b.length); i++) c += Math.abs((a[Math.min(i, a.length - 1)] ?? 0) - (b[Math.min(i, b.length - 1)] ?? 0));
      return c;
    };
    out.push(options.reduce((x, y) => (cost(y) < cost(x) ? y : x)));
  }
  return out;
}

export function generateProgressionQuestion(cfg: ChordConfig, rng: Rng): ChordQuestion {
  const available = PROGRESSIONS.filter((p) => p.minLevel <= Math.max(cfg.level, 1));
  const pool = available.length >= 4 ? available : PROGRESSIONS.slice(0, Math.max(4, available.length));
  for (let attempt = 0; attempt < 30; attempt++) {
    const prog = rng.pick(pool);
    const key = keyFromFifths(rng.int(-3, 3));
    const sc = scale(key.tonic, 'major', 4);
    const specs: ChordSpec[] = prog.steps.map(([deg, raise, quality]) => {
      const p = sc[deg];
      const root: RootClass = { letter: p.letter, accidental: (p.accidental + raise) as Accidental };
      return { root, quality, bass: '1' };
    });
    if (specs.some((s) => Math.abs(s.root.accidental) > 1 || chordHasDoubleAccidental(s.root, s.quality))) continue;
    const chords = voiceLead(specs, cfg.instrument, rng);
    if (!chords) continue;
    const others = rng.shuffle(pool.filter((p) => p.id !== prog.id)).slice(0, 3);
    const opts = rng.shuffle([prog, ...others]).map((p) => ({ label: p.label }));
    const names = chords.map((c) => chordSymbol({ ...c.spec, bass: '1' }, cfg.naming)).join(' – ');
    return {
      id: `cq${++qid}`,
      mode: 'progression',
      level: cfg.level,
      voicing: chords[0],
      answer: chords[0].spec,
      prompt: 'Which progression is this?',
      context: `Key: ${keyName(key)}`,
      options: opts,
      correctIndex: opts.findIndex((o) => o.label === prog.label),
      progression: { key, chords, labels: prog.steps.map((s) => s[3]) },
      itemKey: `progression:${prog.id}`,
      explanation: `${names} = ${prog.label} in ${keyName(key)}.`,
    };
  }
  throw new Error('Could not generate progression');
}

export function checkComponents(q: ChordQuestion, root: RootClass, quality: ChordQuality, inversion: number): { root: boolean; quality: boolean; inversion: boolean; all: boolean } {
  const r = sameSpelledClass(root, q.answer.root);
  const ql = quality === q.answer.quality;
  const inv = !q.components || q.components.inversions.length <= 1 || inversion === q.components.answerInversion;
  return { root: r, quality: ql, inversion: inv, all: r && ql && inv };
}
