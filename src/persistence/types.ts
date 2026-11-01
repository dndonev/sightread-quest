import type { NoteNaming } from '../music-theory/pitch';
import type { Clef } from '../notation/staff';
import type { StageId } from '../adaptive-learning/mastery';

export type Instrument = 'guitar' | 'piano';
export type Experience = 'beginner' | 'intermediate' | 'advanced';

export interface Settings {
  onboarded: boolean;
  instrument: Instrument;
  clef: Clef | 'both';
  experience: Experience;
  dailyGoalMin: number;
  naming: NoteNaming;
  /** For guitar: label octaves by written or sounding (concert) pitch. */
  octaveLabels: 'written' | 'sounding';
  octaveRecognition: boolean;
  showTab: boolean;
  sfx: boolean;
  metronome: boolean;
  volume: number;
  masteryThreshold: number;
  unlockAll: boolean;
  reducedMotion: 'system' | 'on' | 'off';
  daily: { notes: number; chords: number; reading: number };
  mic: { latencyMs: number; confidence: number; noiseFloor: number };
}

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  instrument: 'guitar',
  clef: 'treble',
  experience: 'intermediate',
  dailyGoalMin: 10,
  naming: 'english',
  octaveLabels: 'written',
  octaveRecognition: false,
  showTab: false,
  sfx: true,
  metronome: true,
  volume: 0.8,
  masteryThreshold: 0.9,
  unlockAll: false,
  reducedMotion: 'system',
  daily: { notes: 3, chords: 3, reading: 4 },
  mic: { latencyMs: 80, confidence: 0.85, noiseFloor: 0.01 },
};

export interface Profile {
  xp: number;
  /** ISO dates (YYYY-MM-DD) with at least one completed session. */
  practiceDays: string[];
  achievements: Record<string, number>;
  personalBests: Record<string, number>;
  totals: { answers: number; correct: number; sessions: number; secondsPracticed: number; phrases: number; perfectPhrases: number };
}

export const DEFAULT_PROFILE: Profile = {
  xp: 0,
  practiceDays: [],
  achievements: {},
  personalBests: {},
  totals: { answers: 0, correct: 0, sessions: 0, secondsPracticed: 0, phrases: 0, perfectPhrases: 0 },
};

export interface SessionRecord {
  id?: number;
  date: number;
  day: string;
  stage: StageId;
  mode: string;
  level: number;
  score: number;
  accuracy: number;
  medianMs: number;
  answers: number;
  xp: number;
  durationSec: number;
}
