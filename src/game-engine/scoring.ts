/**
 * Scoring — accuracy first, then speed.
 *
 * Per answer:
 *   wrong / timed out          → 0 points, streak resets
 *   correct                    → (BASE + speedBonus) × streakMultiplier
 *   speedBonus                 = MAX_SPEED_BONUS × clamp((SLOW_MS − t) / (SLOW_MS − FAST_MS), 0, 1)
 *                                only when rolling accuracy over the last ROLLING_WINDOW answers ≥ 80%
 *   streakMultiplier           = 1 + STREAK_STEP × min(streakBefore, STREAK_CAP)
 *
 * Per session:
 *   accuracy                   = correct / total
 *   final                      = round(Σ points × accuracy²)
 *   xp                         = round(final / 10)
 *
 * Squaring accuracy makes random tapping worthless: guessing among 7 letters
 * (~14% accuracy) keeps only ~2% of the raw points.
 */
export const SCORING = {
  BASE: 100,
  MAX_SPEED_BONUS: 50,
  SLOW_MS: 3000,
  FAST_MS: 800,
  STREAK_STEP: 0.05,
  STREAK_CAP: 10,
  ROLLING_WINDOW: 10,
  SPEED_BONUS_MIN_ACCURACY: 0.8,
} as const;

export interface AnswerInput {
  correct: boolean;
  responseMs: number;
  /** Consecutive correct answers before this one. */
  streakBefore: number;
  /** Results of the previous answers (most recent last), used for the rolling-accuracy gate. */
  history: boolean[];
}

export function speedBonus(responseMs: number): number {
  const { SLOW_MS, FAST_MS, MAX_SPEED_BONUS } = SCORING;
  const ratio = Math.min(1, Math.max(0, (SLOW_MS - responseMs) / (SLOW_MS - FAST_MS)));
  return Math.round(MAX_SPEED_BONUS * ratio);
}

export function rollingAccuracy(history: boolean[], window: number = SCORING.ROLLING_WINDOW): number {
  const recent = history.slice(-window);
  if (recent.length === 0) return 1;
  return recent.filter(Boolean).length / recent.length;
}

export function scoreAnswer(a: AnswerInput): number {
  if (!a.correct) return 0;
  // The gate includes the current (correct) answer.
  const gateOpen = rollingAccuracy([...a.history, true]) >= SCORING.SPEED_BONUS_MIN_ACCURACY;
  const bonus = gateOpen ? speedBonus(a.responseMs) : 0;
  const mult = 1 + SCORING.STREAK_STEP * Math.min(a.streakBefore, SCORING.STREAK_CAP);
  return Math.round((SCORING.BASE + bonus) * mult);
}

export interface SessionAnswer {
  correct: boolean;
  responseMs: number;
}

export interface SessionScore {
  total: number;
  correct: number;
  accuracy: number;
  rawPoints: number;
  final: number;
  xp: number;
  medianMs: number;
  bestStreak: number;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export class ScoreKeeper {
  private answers: SessionAnswer[] = [];
  private points = 0;
  private streak = 0;
  private best = 0;

  record(correct: boolean, responseMs: number): number {
    const pts = scoreAnswer({ correct, responseMs, streakBefore: this.streak, history: this.answers.map((a) => a.correct) });
    this.answers.push({ correct, responseMs });
    this.points += pts;
    this.streak = correct ? this.streak + 1 : 0;
    this.best = Math.max(this.best, this.streak);
    return pts;
  }

  get currentStreak() {
    return this.streak;
  }

  summary(): SessionScore {
    return summarize(this.answers, this.points, this.best);
  }
}

export function summarize(answers: SessionAnswer[], rawPoints: number, bestStreak = 0): SessionScore {
  const total = answers.length;
  const correct = answers.filter((a) => a.correct).length;
  const accuracy = total ? correct / total : 0;
  const final = Math.round(rawPoints * accuracy * accuracy);
  return {
    total,
    correct,
    accuracy,
    rawPoints,
    final,
    xp: Math.round(final / 10),
    medianMs: median(answers.filter((a) => a.correct).map((a) => a.responseMs)),
    bestStreak,
  };
}

/** Score for a sight-reading phrase: 0–100 performance %, converted to points. */
export function phraseScore(performancePct: number, timingPct: number): { final: number; xp: number } {
  const acc = Math.max(0, Math.min(1, performancePct));
  const timing = Math.max(0, Math.min(1, timingPct));
  const final = Math.round(1000 * acc * acc * (0.7 + 0.3 * timing));
  return { final, xp: Math.round(final / 10) };
}

/** Cumulative XP needed to reach a player level (level 1 = 0 XP). */
export function xpForLevel(level: number): number {
  return 50 * (level - 1) * level;
}

export function levelFromXp(xp: number): { level: number; into: number; needed: number } {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return { level, into: xp - xpForLevel(level), needed: xpForLevel(level + 1) - xpForLevel(level) };
}
