import type { Profile, SessionRecord } from '../persistence/types';
import type { ItemStat, LevelProgress } from '../adaptive-learning/mastery';
import { levelMastery, mastery } from '../adaptive-learning/mastery';

export function dayKey(d: Date | number = new Date()): string {
  const date = typeof d === 'number' ? new Date(d) : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n));
}

/** Consecutive practice days ending today (or yesterday, so a streak isn't lost before you practise today). */
export function currentStreak(days: string[], today = dayKey()): number {
  const set = new Set(days);
  let cursor = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

export function longestStreak(days: string[]): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export interface AchievementContext {
  profile: Profile;
  session?: SessionRecord;
  itemStats: Record<string, ItemStat>;
  levels: Record<string, LevelProgress>;
  threshold: number;
  perfectPhrase?: boolean;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  check: (c: AchievementContext) => boolean;
}

const stageMastered = (c: AchievementContext, stage: string, level: number) => levelMastery(c.levels[`${stage}:${level}`], c.threshold).mastered;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-steps', title: 'First steps', description: 'Finish your first session.', check: (c) => c.profile.totals.sessions >= 1 },
  { id: 'hundred-notes', title: 'Century', description: 'Answer 100 questions correctly.', check: (c) => c.profile.totals.correct >= 100 },
  { id: 'thousand-notes', title: 'Note machine', description: 'Answer 1,000 questions correctly.', check: (c) => c.profile.totals.correct >= 1000 },
  { id: 'streak-3', title: 'Habit forming', description: 'Practise 3 days in a row.', check: (c) => currentStreak(c.profile.practiceDays) >= 3 },
  { id: 'streak-10', title: 'Ten-day run', description: 'Practise 10 days in a row.', check: (c) => currentStreak(c.profile.practiceDays) >= 10 },
  { id: 'ledger-low', title: 'Down under', description: 'Master ledger lines below the staff (Note Hunter 3).', check: (c) => stageMastered(c, 'notes', 3) },
  { id: 'ledger-high', title: 'Up in the air', description: 'Master ledger lines above the staff (Note Hunter 4).', check: (c) => stageMastered(c, 'notes', 4) },
  { id: 'key-sig', title: 'Key keeper', description: 'Master key signatures (Note Hunter 7).', check: (c) => stageMastered(c, 'notes', 7) },
  { id: 'bass-clef', title: 'Low end', description: 'Master the bass clef (Note Hunter 8).', check: (c) => stageMastered(c, 'notes', 8) },
  {
    id: 'sub-second', title: 'Sub-second', description: 'Median under 0.8 s at ≥ 90% accuracy over a 20+ answer session.',
    check: (c) => !!c.session && c.session.stage === 'notes' && c.session.answers >= 20 && c.session.accuracy >= 0.9 && c.session.medianMs > 0 && c.session.medianMs < 800,
  },
  { id: 'inversions', title: 'Upside down', description: 'Master chord inversions (Chord Decoder 6).', check: (c) => stageMastered(c, 'chords', 6) },
  { id: 'altered', title: 'Altered state', description: 'Master altered dominants (Chord Decoder 9).', check: (c) => stageMastered(c, 'chords', 9) },
  { id: 'perfect-phrase', title: 'Clean read', description: 'Play a sight-reading phrase with no mistakes.', check: (c) => c.profile.totals.perfectPhrases >= 1 },
  { id: 'phrases-50', title: 'Page turner', description: 'Complete 50 sight-reading phrases.', check: (c) => c.profile.totals.phrases >= 50 },
  {
    id: 'all-naturals', title: 'Full staff', description: 'Reach 80% mastery on every natural note E4–F5.',
    check: (c) => ['E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5'].every((n) => mastery(c.itemStats[`note:treble:${n}`]) >= 0.8),
  },
];

export function newlyUnlocked(ctx: AchievementContext): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !ctx.profile.achievements[a.id] && a.check(ctx));
}
