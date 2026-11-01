import {
  type Accidental,
  type Letter,
  type NoteNaming,
  type Pitch,
  LETTERS,
  diatonicIndex,
  displayName,
  fromDiatonicIndex,
  parsePitch,
  pitchToString,
} from '../music-theory/pitch';
import { MeasureAccidentalState, keyAccidentals, keyFromFifths, keyName } from '../music-theory/keys';
import type { Rng } from '../music-theory/random';
import { type Clef, describeStaffPosition, ledgerLines } from '../notation/staff';
import { type ItemStat, pickWeighted } from '../adaptive-learning/mastery';
import type { Instrument } from '../persistence/types';
import { writtenToSounding } from '../music-theory/guitar';

export interface NoteHunterLevel {
  level: number;
  title: string;
  description: string;
  clefs: Clef[];
  /** Written range per clef, inclusive. Guitar may override treble. */
  range: Partial<Record<Clef, [string, string]>>;
  guitarRange?: [string, string];
  accidentals: boolean;
  keySignatures: boolean;
  /** Answer window for the rapid challenge (ms). */
  answerWindowMs?: number;
}

export const NOTE_HUNTER_LEVELS: NoteHunterLevel[] = [
  { level: 1, title: 'Inside the staff', description: 'Treble clef lines and spaces, E4–F5.', clefs: ['treble'], range: { treble: ['E4', 'F5'] }, accidentals: false, keySignatures: false },
  { level: 2, title: 'Edges & middle C', description: 'Adds middle C, D4 and G5 just outside the staff.', clefs: ['treble'], range: { treble: ['C4', 'G5'] }, accidentals: false, keySignatures: false },
  { level: 3, title: 'Ledger lines below', description: 'Down to three ledger lines below the treble staff.', clefs: ['treble'], range: { treble: ['F3', 'F5'] }, guitarRange: ['E3', 'F5'], accidentals: false, keySignatures: false },
  { level: 4, title: 'Ledger lines above', description: 'Up to three ledger lines above the treble staff.', clefs: ['treble'], range: { treble: ['E4', 'E6'] }, accidentals: false, keySignatures: false },
  { level: 5, title: 'Full range', description: 'The whole extended range with ledger lines both ways.', clefs: ['treble'], range: { treble: ['F3', 'C7'] }, guitarRange: ['E3', 'G6'], accidentals: false, keySignatures: false },
  { level: 6, title: 'Sharps, flats & naturals', description: 'Read the accidental as well as the letter.', clefs: ['treble'], range: { treble: ['A3', 'A5'] }, guitarRange: ['E3', 'A5'], accidentals: true, keySignatures: false },
  { level: 7, title: 'Key signatures', description: 'Apply the key signature and accidentals carried through the bar.', clefs: ['treble'], range: { treble: ['C4', 'G5'] }, accidentals: true, keySignatures: true },
  { level: 8, title: 'Bass clef', description: 'Bass clef, C2–E4, with ledger lines.', clefs: ['bass'], range: { bass: ['C2', 'E4'] }, accidentals: false, keySignatures: false },
  { level: 9, title: 'Mixed clefs', description: 'Treble and bass alternate — the same pitch moves on the staff.', clefs: ['treble', 'bass'], range: { treble: ['A3', 'C6'], bass: ['E2', 'E4'] }, accidentals: false, keySignatures: false },
  { level: 10, title: 'Rapid recognition', description: 'Full range, accidentals, 1.5-second answer window.', clefs: ['treble', 'bass'], range: { treble: ['F3', 'C6'], bass: ['E2', 'E4'] }, guitarRange: ['E3', 'G6'], accidentals: true, keySignatures: false, answerWindowMs: 1500 },
];

export interface NoteHunterConfig {
  level: number;
  instrument: Instrument;
  /** Restrict clefs (from settings); level clefs are used when compatible. */
  preferredClef: Clef | 'both';
  octaveRecognition: boolean;
  /** Custom range override (written), from Practice Lab. */
  customRange?: [string, string];
  customAccidentals?: boolean;
  customClef?: Clef;
}

export interface ContextNote {
  pitch: Pitch;
  printed: Accidental | null;
}

export interface NoteQuestion {
  id: string;
  clef: Clef;
  keyFifths: number;
  /** Notes earlier in the same measure (key-signature level only). */
  context: ContextNote[];
  target: Pitch;
  printed: Accidental | null;
  requireAccidental: boolean;
  itemKey: string;
}

export interface NoteAnswer {
  letter: Letter;
  accidental?: Accidental;
  octave?: number;
}

export function levelConfig(level: number): NoteHunterLevel {
  return NOTE_HUNTER_LEVELS[Math.max(0, Math.min(NOTE_HUNTER_LEVELS.length - 1, level - 1))];
}

export function noteItemKey(clef: Clef, p: Pitch): string {
  return `note:${clef}:${pitchToString(p)}`;
}

function rangeFor(cfg: NoteHunterConfig, lvl: NoteHunterLevel, clef: Clef): [Pitch, Pitch] {
  if (cfg.customRange) return [parsePitch(cfg.customRange[0]), parsePitch(cfg.customRange[1])];
  const r = clef === 'treble' && cfg.instrument === 'guitar' && lvl.guitarRange ? lvl.guitarRange : lvl.range[clef] ?? lvl.range.treble ?? ['C4', 'C5'];
  return [parsePitch(r[0]), parsePitch(r[1])];
}

export function clefsFor(cfg: NoteHunterConfig): Clef[] {
  if (cfg.customClef) return [cfg.customClef];
  return levelConfig(cfg.level).clefs;
}

/** All candidate written pitches for a level + clef. */
export function candidatePitches(cfg: NoteHunterConfig, clef: Clef): Pitch[] {
  const lvl = levelConfig(cfg.level);
  const [lo, hi] = rangeFor(cfg, lvl, clef);
  const accidentals = cfg.customAccidentals ?? (lvl.accidentals && !lvl.keySignatures);
  const out: Pitch[] = [];
  for (let d = diatonicIndex(lo); d <= diatonicIndex(hi); d++) {
    const nat = fromDiatonicIndex(d);
    out.push(nat);
    if (accidentals) {
      // Common single accidentals only — no E#, B#, Fb, Cb at these levels.
      if (!['E', 'B'].includes(nat.letter)) out.push({ ...nat, accidental: 1 });
      if (!['F', 'C'].includes(nat.letter)) out.push({ ...nat, accidental: -1 });
    }
  }
  return out;
}

let questionCounter = 0;

export function generateNoteQuestion(
  cfg: NoteHunterConfig,
  rng: Rng,
  stats: Record<string, ItemStat> = {},
  now = Date.now(),
  options: { previous?: NoteQuestion; weakOnly?: boolean; clefOverride?: Clef } = {},
): NoteQuestion {
  const lvl = levelConfig(cfg.level);
  const clefs = clefsFor(cfg);
  let clef: Clef = options.clefOverride ?? (clefs.length > 1 ? (options.previous ? clefs.find((c) => c !== options.previous!.clef) ?? clefs[0] : rng.pick(clefs)) : clefs[0]);
  if (clefs.length > 1 && rng.chance(0.35)) clef = rng.pick(clefs);
  const requireAccidental = cfg.customAccidentals ?? lvl.accidentals;

  if (lvl.keySignatures && !cfg.customRange) return generateKeySignatureQuestion(cfg, rng, clef, stats, now, options.previous);

  const pool = candidatePitches(cfg, clef);
  const target = pickWeighted(rng, pool, (p) => noteItemKey(clef, p), stats, now, {
    avoidKey: options.previous ? noteItemKey(options.previous.clef, options.previous.target) : undefined,
    weakOnly: options.weakOnly,
  });
  // Occasionally show a courtesy natural at the accidental level.
  const printed: Accidental | null = target.accidental !== 0 ? target.accidental : requireAccidental && rng.chance(0.2) ? 0 : null;
  return {
    id: `nq${++questionCounter}`,
    clef,
    keyFifths: 0,
    context: [],
    target,
    printed,
    requireAccidental,
    itemKey: noteItemKey(clef, target),
  };
}

function generateKeySignatureQuestion(
  cfg: NoteHunterConfig,
  rng: Rng,
  clef: Clef,
  stats: Record<string, ItemStat>,
  now: number,
  previous?: NoteQuestion,
): NoteQuestion {
  const lvl = levelConfig(cfg.level);
  const [lo, hi] = rangeFor(cfg, lvl, clef);
  const fifths = rng.pick([-4, -3, -2, -1, 1, 2, 3, 4]);
  const keyMap = keyAccidentals(fifths);
  const naturals: Pitch[] = [];
  for (let d = diatonicIndex(lo); d <= diatonicIndex(hi); d++) naturals.push(fromDiatonicIndex(d));

  // Bias toward letters that the key signature alters — that's the skill being trained.
  const slot = pickWeighted(rng, naturals, (p) => `note:${clef}:${p.letter}${p.octave}@k`, stats, now, {
    avoidKey: previous ? `note:${clef}:${previous.target.letter}${previous.target.octave}@k` : undefined,
  });
  const altered = keyMap[slot.letter] !== 0;
  const target0 = altered || rng.chance(0.3) ? slot : rng.pick(naturals.filter((p) => keyMap[p.letter] !== 0)) ?? slot;

  const context: ContextNote[] = [];
  const contextCount = rng.int(1, 3);
  const carry = rng.chance(0.45);
  const trapOtherOctave = !carry && rng.chance(0.35);
  const carryIndex = rng.int(0, contextCount - 1);
  for (let i = 0; i < contextCount; i++) {
    if (i === carryIndex && (carry || trapOtherOctave)) {
      let octave = target0.octave;
      if (trapOtherOctave) {
        const up = { ...target0, octave: target0.octave + 1 };
        const down = { ...target0, octave: target0.octave - 1 };
        octave = diatonicIndex(up) <= diatonicIndex(hi) + 2 ? up.octave : down.octave;
      }
      const keyAcc = keyMap[target0.letter];
      const choices = ([-1, 0, 1] as Accidental[]).filter((a) => a !== keyAcc);
      const acc = rng.pick(choices);
      context.push({ pitch: { letter: target0.letter, accidental: acc, octave }, printed: acc });
    } else {
      const others = naturals.filter((p) => p.letter !== target0.letter);
      const n = rng.pick(others);
      context.push({ pitch: { ...n, accidental: keyMap[n.letter] }, printed: null });
    }
  }
  // Optionally an explicit accidental on the target itself.
  const explicit = rng.chance(0.2);
  const state = new MeasureAccidentalState(fifths);
  for (const c of context) state.applyPrinted(c.pitch.letter, c.pitch.octave, c.printed);
  let printed: Accidental | null = null;
  let accidental = state.implied(target0.letter, target0.octave);
  if (explicit) {
    const choices = ([-1, 0, 1] as Accidental[]).filter((a) => a !== accidental);
    printed = rng.pick(choices);
    accidental = printed;
  }
  const target: Pitch = { letter: target0.letter, accidental, octave: target0.octave };
  return {
    id: `nq${++questionCounter}`,
    clef,
    keyFifths: fifths,
    context,
    target,
    printed,
    requireAccidental: true,
    itemKey: `note:${clef}:${target0.letter}${target0.octave}@k`,
  };
}

export function expectedOctave(q: NoteQuestion, instrument: Instrument, octaveLabels: 'written' | 'sounding'): number {
  if (instrument === 'guitar' && octaveLabels === 'sounding' && q.clef === 'treble') return writtenToSounding(q.target).octave;
  return q.target.octave;
}

export function checkNoteAnswer(
  q: NoteQuestion,
  a: NoteAnswer,
  opts: { octaveRecognition: boolean; instrument: Instrument; octaveLabels: 'written' | 'sounding' },
): boolean {
  if (a.letter !== q.target.letter) return false;
  if (q.requireAccidental && (a.accidental ?? 0) !== q.target.accidental) return false;
  if (opts.octaveRecognition && a.octave !== expectedOctave(q, opts.instrument, opts.octaveLabels)) return false;
  return true;
}

/** Short explanation of the correct answer, shown after mistakes. */
export function explainNote(q: NoteQuestion, naming: NoteNaming = 'english'): string {
  const clefName = q.clef === 'treble' ? 'Treble' : 'Bass';
  const pos = describeStaffPosition(q.target, q.clef);
  const name = displayName(q.target, naming, true);
  const parts = [`${clefName} clef, ${pos} → ${name}.`];
  const led = ledgerLines(q.target, q.clef);
  if (led.count > 0) {
    parts.push(`Count ${led.count} ledger line${led.count > 1 ? 's' : ''} ${led.direction} the staff.`);
  }
  if (q.keyFifths !== 0) {
    const key = keyFromFifths(q.keyFifths);
    const keyAcc = keyAccidentals(q.keyFifths)[q.target.letter];
    const carried = q.context.find((c) => c.printed !== null && c.pitch.letter === q.target.letter && c.pitch.octave === q.target.octave);
    const otherOct = q.context.find((c) => c.printed !== null && c.pitch.letter === q.target.letter && c.pitch.octave !== q.target.octave);
    if (q.printed !== null) parts.push('The accidental printed on the note overrides everything else.');
    else if (carried) parts.push(`The ${displayName({ letter: carried.pitch.letter, accidental: carried.printed! }, naming)} earlier in this bar still applies until the barline.`);
    else {
      if (otherOct) parts.push('An accidental only affects its own octave, so the one earlier in the bar does not apply here.');
      parts.push(
        keyAcc !== 0
          ? `${keyName(key)}: the key signature makes every ${q.target.letter} ${keyAcc > 0 ? 'sharp' : 'flat'}.`
          : `${keyName(key)}: ${q.target.letter} is not altered by this key signature.`,
      );
    }
  }
  return parts.join(' ');
}

export const LETTER_BUTTONS: Letter[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
export const ALL_LETTERS = LETTERS;

/** Octave buttons to offer: every octave that occurs in the level's range (independent of the answer). */
export function octaveChoices(cfg: NoteHunterConfig, clef: Clef, octaveLabels: 'written' | 'sounding'): number[] {
  const shift = cfg.instrument === 'guitar' && octaveLabels === 'sounding' && clef === 'treble' ? -1 : 0;
  const octs = new Set(candidatePitches({ ...cfg, customAccidentals: false }, clef).map((p) => p.octave + shift));
  return [...octs].sort((a, b) => a - b);
}
