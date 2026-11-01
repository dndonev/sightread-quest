import type { Accidental, Letter } from '../music-theory/pitch';
import { midi } from '../music-theory/pitch';
import { type Exercise, type ScoreEvent, melodyPitch, onsetEvents, soundingTicks } from './sightReading';
import { secondsPerTick } from '../music-theory/rhythm';

/**
 * All evaluation works in *ticks* so pauses and tempo changes don't distort it.
 * Inputs are converted from audio-clock time to ticks at the moment they happen.
 */

export interface TimingTolerance {
  /** Max |offset| in ticks for a hit. */
  hitTicks: number;
  /** Offsets within this count as "perfect". */
  perfectTicks: number;
}

/** Tolerance scales with tempo: ±max(60ms, 22% of a beat) capped at 180ms, expressed in ticks. */
export function toleranceFor(bpm: number, ex: Pick<Exercise, 'timeSig'>): TimingTolerance {
  const spt = secondsPerTick(bpm, ex.timeSig);
  const beatSec = spt * (ex.timeSig.beatValue === 8 && ex.timeSig.beats % 3 === 0 && ex.timeSig.beats > 3 ? 72 : (48 * 4) / ex.timeSig.beatValue);
  const hitSec = Math.min(0.18, Math.max(0.06, beatSec * 0.22));
  return { hitTicks: hitSec / spt, perfectTicks: (hitSec / spt) * 0.4 };
}

/* ---------------- Rhythm (tap) ---------------- */

export interface Tap {
  tick: number;
  /** Hold length in ticks, if the release was captured. */
  holdTicks?: number;
}

export interface RhythmNoteResult {
  eventId: number;
  status: 'hit' | 'missed';
  offsetTicks?: number;
  /** held / expected; only for notes ≥ a quarter where duration is meaningful. */
  durationRatio?: number;
}

export interface RhythmResult {
  notes: RhythmNoteResult[];
  extraTaps: number;
  hits: number;
  expected: number;
  /** 0..1 — hits minus half the extras, over expected. */
  accuracy: number;
  /** 0..1 — how tight the hits were. */
  timing: number;
  meanOffsetTicks: number;
  durationAccuracy: number | null;
}

export function evaluateRhythm(ex: Exercise, taps: Tap[], tol: TimingTolerance): RhythmResult {
  const expected = onsetEvents(ex);
  const sortedTaps = [...taps].sort((a, b) => a.tick - b.tick);
  const used = new Set<number>();
  const notes: RhythmNoteResult[] = [];
  for (const ev of expected) {
    let bestIdx = -1;
    let bestAbs = Infinity;
    sortedTaps.forEach((t, i) => {
      if (used.has(i)) return;
      const off = t.tick - ev.start;
      if (Math.abs(off) <= tol.hitTicks && Math.abs(off) < bestAbs) {
        bestAbs = Math.abs(off);
        bestIdx = i;
      }
    });
    if (bestIdx >= 0) {
      used.add(bestIdx);
      const tap = sortedTaps[bestIdx];
      const len = soundingTicks(ex, ev);
      const res: RhythmNoteResult = { eventId: ev.id, status: 'hit', offsetTicks: tap.tick - ev.start };
      if (tap.holdTicks !== undefined && len >= 48) res.durationRatio = tap.holdTicks / len;
      notes.push(res);
    } else notes.push({ eventId: ev.id, status: 'missed' });
  }
  const hits = notes.filter((n) => n.status === 'hit');
  const extra = sortedTaps.length - used.size;
  const offsets = hits.map((h) => h.offsetTicks!);
  const meanAbs = offsets.length ? offsets.reduce((s, o) => s + Math.abs(o), 0) / offsets.length : 0;
  const durs = hits.filter((h) => h.durationRatio !== undefined);
  return {
    notes,
    extraTaps: extra,
    hits: hits.length,
    expected: expected.length,
    accuracy: expected.length ? Math.max(0, hits.length - 0.5 * extra) / expected.length : 0,
    timing: hits.length ? Math.max(0, 1 - meanAbs / tol.hitTicks) : 0,
    meanOffsetTicks: offsets.length ? offsets.reduce((s, o) => s + o, 0) / offsets.length : 0,
    durationAccuracy: durs.length ? durs.filter((d) => Math.abs(d.durationRatio! - 1) <= 0.35).length / durs.length : null,
  };
}

/* ---------------- Melody performance (virtual instrument / mic) ---------------- */

export interface PlayedNote {
  tick: number;
  /** Sounding MIDI number. */
  midi: number;
  holdTicks?: number;
}

export type PerformanceStatus = 'correct' | 'wrong-pitch' | 'wrong-octave' | 'missed';

export interface PerformanceNoteResult {
  eventId: number;
  status: PerformanceStatus;
  offsetTicks?: number;
  playedMidi?: number;
  durationRatio?: number;
}

export interface PerformanceResult {
  notes: PerformanceNoteResult[];
  extraNotes: number;
  correct: number;
  expected: number;
  pitchAccuracy: number;
  timing: number;
  durationAccuracy: number | null;
  /** Longest run of consecutive correct notes / expected. */
  continuity: number;
  meanOffsetTicks: number;
}

/**
 * @param transposeSemitones semitones to add to WRITTEN pitch to get SOUNDING pitch (guitar: -12).
 */
export function evaluatePerformance(ex: Exercise, played: PlayedNote[], tol: TimingTolerance, transposeSemitones: number): PerformanceResult {
  const expected = onsetEvents(ex);
  const sorted = [...played].sort((a, b) => a.tick - b.tick);
  const used = new Set<number>();
  const notes: PerformanceNoteResult[] = [];
  for (const ev of expected) {
    const target = midi(melodyPitch(ev)) + transposeSemitones;
    const window = sorted.map((p, i) => ({ p, i })).filter(({ p, i }) => !used.has(i) && Math.abs(p.tick - ev.start) <= tol.hitTicks);
    const exact = window.filter(({ p }) => p.midi === target).sort((a, b) => Math.abs(a.p.tick - ev.start) - Math.abs(b.p.tick - ev.start))[0];
    const any = window.sort((a, b) => Math.abs(a.p.tick - ev.start) - Math.abs(b.p.tick - ev.start))[0];
    const pick = exact ?? any;
    if (!pick) {
      notes.push({ eventId: ev.id, status: 'missed' });
      continue;
    }
    used.add(pick.i);
    let status: PerformanceStatus = 'correct';
    if (pick.p.midi !== target) status = ((pick.p.midi - target) % 12 + 12) % 12 === 0 ? 'wrong-octave' : 'wrong-pitch';
    const len = soundingTicks(ex, ev);
    notes.push({
      eventId: ev.id,
      status,
      offsetTicks: pick.p.tick - ev.start,
      playedMidi: pick.p.midi,
      durationRatio: pick.p.holdTicks !== undefined && len >= 48 ? pick.p.holdTicks / len : undefined,
    });
  }
  const correct = notes.filter((n) => n.status === 'correct');
  let run = 0;
  let best = 0;
  for (const n of notes) {
    run = n.status === 'correct' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const offsets = correct.map((c) => c.offsetTicks!);
  const meanAbs = offsets.length ? offsets.reduce((s, o) => s + Math.abs(o), 0) / offsets.length : 0;
  const durs = correct.filter((c) => c.durationRatio !== undefined);
  return {
    notes,
    extraNotes: sorted.length - used.size,
    correct: correct.length,
    expected: expected.length,
    pitchAccuracy: expected.length ? Math.max(0, correct.length - 0.5 * (sorted.length - used.size)) / expected.length : 0,
    timing: correct.length ? Math.max(0, 1 - meanAbs / tol.hitTicks) : 0,
    durationAccuracy: durs.length ? durs.filter((d) => Math.abs(d.durationRatio! - 1) <= 0.35).length / durs.length : null,
    continuity: expected.length ? best / expected.length : 0,
    meanOffsetTicks: offsets.length ? offsets.reduce((s, o) => s + o, 0) / offsets.length : 0,
  };
}

/* ---------------- Read & identify ---------------- */

export interface IdentifyAnswer {
  tick: number;
  letter: Letter;
  accidental: Accidental;
}

export interface IdentifyNoteResult {
  eventId: number;
  status: 'correct' | 'wrong' | 'missed';
  answeredTick?: number;
}

export interface IdentifyResult {
  notes: IdentifyNoteResult[];
  correct: number;
  expected: number;
  accuracy: number;
}

/**
 * The answer for a note counts if given between (start − early) and the note's end.
 * Only the first answer inside a note's window is graded.
 */
export function evaluateIdentify(ex: Exercise, answers: IdentifyAnswer[], requireAccidental: boolean, earlyTicks = 12): IdentifyResult {
  const expected = onsetEvents(ex);
  const used = new Set<number>();
  const notes = expected.map((ev): IdentifyNoteResult => {
    const end = ev.start + soundingTicks(ex, ev);
    const idx = answers.findIndex((a, i) => !used.has(i) && a.tick >= ev.start - earlyTicks && a.tick < end);
    if (idx < 0) return { eventId: ev.id, status: 'missed' };
    used.add(idx);
    const a = answers[idx];
    const p = melodyPitch(ev);
    const ok = a.letter === p.letter && (!requireAccidental || a.accidental === p.accidental);
    return { eventId: ev.id, status: ok ? 'correct' : 'wrong', answeredTick: a.tick };
  });
  const correct = notes.filter((n) => n.status === 'correct').length;
  return { notes, correct, expected: expected.length, accuracy: expected.length ? correct / expected.length : 0 };
}

/** For a live UI: which note is being asked at this tick? */
export function activeIdentifyEvent(ex: Exercise, tick: number, earlyTicks = 12): ScoreEvent | undefined {
  return onsetEvents(ex).find((ev) => tick >= ev.start - earlyTicks && tick < ev.start + soundingTicks(ex, ev));
}

/* ---------------- Feedback ---------------- */

export function gradeFor(pct: number): 'S' | 'A' | 'B' | 'C' | 'D' {
  if (pct >= 0.97) return 'S';
  if (pct >= 0.9) return 'A';
  if (pct >= 0.75) return 'B';
  if (pct >= 0.5) return 'C';
  return 'D';
}

export function timingFeedback(meanOffsetTicks: number, tol: TimingTolerance, msPerTick: number): string | null {
  const ms = Math.round(meanOffsetTicks * msPerTick);
  if (Math.abs(meanOffsetTicks) < tol.perfectTicks * 0.5) return null;
  return ms < 0 ? `You tend to rush — on average ${-ms} ms early.` : `You tend to drag — on average ${ms} ms late.`;
}

export function measureBreakdown<T extends { eventId: number; status: string }>(ex: Exercise, results: T[], good: string): string[] {
  const byMeasure = new Map<number, number>();
  for (const r of results) {
    if (r.status === good) continue;
    const ev = ex.events.find((e) => e.id === r.eventId)!;
    byMeasure.set(ev.measure, (byMeasure.get(ev.measure) ?? 0) + 1);
  }
  return [...byMeasure.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([m, n]) => `Bar ${m + 1}: ${n} note${n > 1 ? 's' : ''} to review.`);
}

export function octaveErrorHint(results: PerformanceNoteResult[], instrument: 'guitar' | 'piano'): string | null {
  const n = results.filter((r) => r.status === 'wrong-octave').length;
  if (!n) return null;
  return instrument === 'guitar'
    ? `${n} note${n > 1 ? 's were' : ' was'} in the wrong octave. Remember: guitar sounds an octave lower than written.`
    : `${n} note${n > 1 ? 's were' : ' was'} in the wrong octave.`;
}

