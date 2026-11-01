import type { Rng } from '../music-theory/random';
import { median } from '../game-engine/scoring';

export type ItemCategory = 'note' | 'chord' | 'interval' | 'rhythm' | 'progression';

/**
 * Per-item learning record (one per note-at-position, chord quality, interval,
 * rhythm cell …). Scheduling is a light Leitner system: correct+fluent answers
 * promote the item to a longer review interval, mistakes send it back to box 0.
 */
export interface ItemStat {
  key: string;
  category: ItemCategory;
  attempts: number;
  correct: number;
  /** Last 12 results, most recent last. */
  recent: boolean[];
  /** Last 20 correct response times (ms). */
  times: number[];
  lastPracticed: number;
  streak: number;
  box: number;
  dueAt: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** Review intervals per Leitner box. */
export const BOX_INTERVALS = [0, 2 * MIN, 15 * MIN, 2 * HOUR, DAY, 3 * DAY, 7 * DAY, 21 * DAY];

export function categoryOf(key: string): ItemCategory {
  return key.split(':')[0] as ItemCategory;
}

export function newItemStat(key: string): ItemStat {
  return { key, category: categoryOf(key), attempts: 0, correct: 0, recent: [], times: [], lastPracticed: 0, streak: 0, box: 0, dueAt: 0 };
}

export function updateItemStat(
  stat: ItemStat | undefined,
  key: string,
  correct: boolean,
  responseMs: number,
  now: number,
  fluentMs = 3000,
): ItemStat {
  const s = stat ? { ...stat, recent: [...stat.recent], times: [...stat.times] } : newItemStat(key);
  s.attempts += 1;
  s.lastPracticed = now;
  s.recent.push(correct);
  if (s.recent.length > 12) s.recent.shift();
  if (correct) {
    s.correct += 1;
    s.streak += 1;
    s.times.push(responseMs);
    if (s.times.length > 20) s.times.shift();
    if (responseMs <= fluentMs) s.box = Math.min(BOX_INTERVALS.length - 1, s.box + 1);
  } else {
    s.streak = 0;
    s.box = 0;
  }
  s.dueAt = now + BOX_INTERVALS[s.box];
  return s;
}

export function accuracy(s: ItemStat | undefined): number {
  return s && s.attempts ? s.correct / s.attempts : 0;
}

export function recentAccuracy(s: ItemStat | undefined): number {
  if (!s || !s.recent.length) return 0;
  return s.recent.filter(Boolean).length / s.recent.length;
}

export function medianTime(s: ItemStat | undefined): number {
  return s ? median(s.times) : 0;
}

/**
 * Estimated mastery 0..1:
 *   blended accuracy (60% recent, 40% lifetime)
 *   × fluency factor (0.7 … 1.0 depending on median time vs target)
 *   × confidence (grows with sample size, full at 8 attempts)
 */
export function mastery(s: ItemStat | undefined, targetMs = 1500): number {
  if (!s || s.attempts === 0) return 0;
  const acc = 0.6 * recentAccuracy(s) + 0.4 * accuracy(s);
  const med = medianTime(s);
  const fluency = med === 0 ? 0.7 : 0.7 + 0.3 * Math.min(1, Math.max(0, (targetMs * 2 - med) / targetMs));
  const confidence = Math.min(1, s.attempts / 8);
  return acc * fluency * confidence;
}

/**
 * Review priority — higher means "show this soon". Every item keeps a floor
 * weight of 1, so mastered material still comes back for periodic review.
 */
export function reviewPriority(s: ItemStat | undefined, now: number, targetMs = 1500): number {
  if (!s || s.attempts === 0) return 2.5;
  const m = mastery(s, targetMs);
  let w = 1 + 4 * (1 - m);
  if (now >= s.dueAt) {
    const interval = Math.max(MIN, BOX_INTERVALS[s.box] || MIN);
    w += 2 + Math.min(3, (now - s.dueAt) / interval);
  }
  return w;
}

export function pickWeighted<T>(
  rng: Rng,
  candidates: readonly T[],
  keyOf: (c: T) => string,
  stats: Record<string, ItemStat>,
  now: number,
  options: { avoidKey?: string; weakOnly?: boolean; targetMs?: number } = {},
): T {
  let pool = candidates.filter((c) => keyOf(c) !== options.avoidKey);
  if (!pool.length) pool = [...candidates];
  if (options.weakOnly) {
    const weak = weakestItems(pool, keyOf, stats, Math.max(4, Math.ceil(pool.length / 4)), options.targetMs);
    if (weak.length) pool = weak;
  }
  return rng.weighted(pool, (c) => reviewPriority(stats[keyOf(c)], now, options.targetMs));
}

/** Items with the lowest mastery among those attempted (fallback: unattempted). */
export function weakestItems<T>(pool: readonly T[], keyOf: (c: T) => string, stats: Record<string, ItemStat>, n: number, targetMs = 1500): T[] {
  const attempted = pool.filter((c) => (stats[keyOf(c)]?.attempts ?? 0) > 0);
  const ranked = [...attempted].sort((a, b) => mastery(stats[keyOf(a)], targetMs) - mastery(stats[keyOf(b)], targetMs));
  return ranked.slice(0, n);
}

/* ---------------- Level progression ---------------- */

export interface LevelProgress {
  id: string;
  stage: StageId;
  level: number;
  /** Last 40 results. */
  recent: { c: boolean; ms: number }[];
  bestScore: number;
  sessions: number;
}

export type StageId = 'notes' | 'chords' | 'reading';

export function levelId(stage: StageId, level: number) {
  return `${stage}:${level}`;
}

export function recordLevelResult(lp: LevelProgress | undefined, stage: StageId, level: number, correct: boolean, ms: number): LevelProgress {
  const p: LevelProgress = lp ? { ...lp, recent: [...lp.recent] } : { id: levelId(stage, level), stage, level, recent: [], bestScore: 0, sessions: 0 };
  p.recent.push({ c: correct, ms });
  if (p.recent.length > 40) p.recent.shift();
  return p;
}

export const MASTERY_SAMPLE = 20;

/**
 * A level is mastered when, over at least MASTERY_SAMPLE recent answers,
 * accuracy ≥ threshold and (optionally) the median correct time ≤ fluency target.
 * XP plays no part in advancement.
 */
export function levelMastery(lp: LevelProgress | undefined, threshold: number, fluencyMs?: number) {
  const sample = lp?.recent.slice(-MASTERY_SAMPLE) ?? [];
  const acc = sample.length ? sample.filter((r) => r.c).length / sample.length : 0;
  const med = median(sample.filter((r) => r.c).map((r) => r.ms));
  const enough = sample.length >= MASTERY_SAMPLE;
  const fluent = fluencyMs === undefined || med <= fluencyMs;
  return {
    accuracy: acc,
    medianMs: med,
    samples: sample.length,
    mastered: enough && acc >= threshold && fluent,
    /** 0..1 progress towards mastery, for UI. */
    progress: Math.min(1, sample.length / MASTERY_SAMPLE) * Math.min(1, acc / threshold),
  };
}

export function isLevelUnlocked(
  progress: Record<string, LevelProgress>,
  stage: StageId,
  level: number,
  threshold: number,
  unlockAll: boolean,
  fluencyMs?: number,
): boolean {
  if (unlockAll || level <= 1) return true;
  return levelMastery(progress[levelId(stage, level - 1)], threshold, fluencyMs).mastered;
}
