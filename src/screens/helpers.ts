import { type LevelProgress, type StageId, isLevelUnlocked, levelId, levelMastery } from '../adaptive-learning/mastery';
import type { SessionRecord, Settings } from '../persistence/types';
import { NOTE_HUNTER_LEVELS } from '../game-engine/noteHunter';
import { CHORD_LEVELS } from '../game-engine/chordDecoder';
import { READING_LEVELS } from '../game-engine/sightReading';
import { dayKey } from '../game-engine/progress';

export const STAGES: { id: StageId; title: string; subtitle: string; screen: 'notes' | 'chords' | 'reading'; levels: { level: number; title: string; description: string }[] }[] = [
  { id: 'notes', title: 'Note Hunter', subtitle: 'Instant note recognition, ledger lines, key signatures', screen: 'notes', levels: NOTE_HUNTER_LEVELS },
  { id: 'chords', title: 'Chord Decoder', subtitle: 'Read harmony: qualities, inversions, voicings', screen: 'chords', levels: CHORD_LEVELS },
  { id: 'reading', title: 'Sight-Reading Arena', subtitle: 'Perform unfamiliar music in real time', screen: 'reading', levels: READING_LEVELS },
];

export function fluencyMs(settings: Settings, stage: StageId): number | undefined {
  if (stage !== 'notes') return undefined;
  return settings.experience === 'advanced' ? 800 : settings.experience === 'intermediate' ? 1500 : 3000;
}

export function stageMastery(levels: Record<string, LevelProgress>, stage: StageId, settings: Settings): number {
  let sum = 0;
  for (let l = 1; l <= 10; l++) {
    const m = levelMastery(levels[levelId(stage, l)], settings.masteryThreshold, fluencyMs(settings, stage));
    sum += m.mastered ? 1 : m.progress * 0.9;
  }
  return sum / 10;
}

export function highestUnlocked(levels: Record<string, LevelProgress>, stage: StageId, settings: Settings): number {
  let best = 1;
  for (let l = 1; l <= 10; l++) if (isLevelUnlocked(levels, stage, l, settings.masteryThreshold, false, fluencyMs(settings, stage))) best = l;
  return best;
}

export function minutesToday(sessions: SessionRecord[]): number {
  const today = dayKey();
  return sessions.filter((s) => s.day === today).reduce((m, s) => m + s.durationSec, 0) / 60;
}

export function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Late-night practice' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
