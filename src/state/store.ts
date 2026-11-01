import { create } from 'zustand';
import { getRepository } from '../persistence/db';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Profile, type SessionRecord, type Settings } from '../persistence/types';
import {
  type ItemStat,
  type LevelProgress,
  type StageId,
  levelId,
  levelMastery,
  recordLevelResult,
  updateItemStat,
} from '../adaptive-learning/mastery';
import { type Achievement, dayKey, newlyUnlocked } from '../game-engine/progress';
import { audio } from '../audio/engine';

export type ScreenName = 'onboarding' | 'home' | 'stages' | 'levels' | 'notes' | 'chords' | 'reading' | 'daily' | 'lab' | 'stats' | 'settings';

export interface Route {
  name: ScreenName;
  params?: Record<string, string | number | boolean | undefined>;
}

export interface SessionOutcome {
  xpGained: number;
  newAchievements: Achievement[];
  newlyMastered: boolean;
  personalBest: boolean;
}

interface State {
  loaded: boolean;
  settings: Settings;
  profile: Profile;
  itemStats: Record<string, ItemStat>;
  levels: Record<string, LevelProgress>;
  sessions: SessionRecord[];
  route: Route;
  toast: string | null;
  init: () => Promise<void>;
  navigate: (name: ScreenName, params?: Route['params'], replace?: boolean) => void;
  back: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  recordAnswer: (a: { itemKey?: string; itemKeys?: string[]; correct: boolean; ms: number; stage: StageId; level: number; fluentMs?: number; skipLevel?: boolean }) => void;
  finishSession: (s: Omit<SessionRecord, 'date' | 'day'>, extra?: { phrases?: number; perfectPhrases?: number; wasMastered?: boolean }) => SessionOutcome;
  showToast: (msg: string) => void;
  resetProgress: () => Promise<void>;
}

const dirtyStats = new Set<string>();
const dirtyLevels = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(get: () => State) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow(get);
  }, 800);
}

async function flushNow(get: () => State) {
  const s = get();
  const repo = getRepository();
  const stats = [...dirtyStats].map((k) => s.itemStats[k]).filter(Boolean);
  const levels = [...dirtyLevels].map((k) => s.levels[k]).filter(Boolean);
  dirtyStats.clear();
  dirtyLevels.clear();
  try {
    if (stats.length) await repo.saveItemStats(stats);
    if (levels.length) await repo.saveLevels(levels);
  } catch (e) {
    console.warn('persist failed', e);
  }
}

function routeFromHash(): Route | null {
  const h = location.hash.replace(/^#\/?/, '');
  if (!h) return null;
  const [name, query] = h.split('?');
  const params: Record<string, string | number> = {};
  new URLSearchParams(query ?? '').forEach((v, k) => (params[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v));
  return { name: name as ScreenName, params };
}

function hashFor(r: Route): string {
  const q = new URLSearchParams();
  Object.entries(r.params ?? {}).forEach(([k, v]) => v !== undefined && q.set(k, String(v)));
  const qs = q.toString();
  return `#/${r.name}${qs ? `?${qs}` : ''}`;
}

export const useStore = create<State>((set, get) => ({
  loaded: false,
  settings: DEFAULT_SETTINGS,
  profile: DEFAULT_PROFILE,
  itemStats: {},
  levels: {},
  sessions: [],
  route: { name: 'home' },
  toast: null,

  init: async () => {
    let data;
    try {
      data = await getRepository().load();
    } catch (e) {
      console.warn('IndexedDB unavailable; progress will not persist', e);
      data = { settings: DEFAULT_SETTINGS, profile: DEFAULT_PROFILE, itemStats: {}, levels: {}, sessions: [] };
    }
    const initial = data.settings.onboarded ? routeFromHash() ?? { name: 'home' as ScreenName } : { name: 'onboarding' as ScreenName };
    history.replaceState({ route: initial }, '', hashFor(initial));
    window.addEventListener('popstate', (e) => {
      const r = (e.state?.route as Route) ?? routeFromHash() ?? { name: 'home' };
      set({ route: r });
    });
    window.addEventListener('pagehide', () => void flushNow(get));
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flushNow(get));
    audio.sfxEnabled = data.settings.sfx;
    set({ ...data, route: initial, loaded: true });
  },

  navigate: (name, params, replace = false) => {
    const route = { name, params };
    if (replace) history.replaceState({ route }, '', hashFor(route));
    else history.pushState({ route }, '', hashFor(route));
    set({ route });
    window.scrollTo({ top: 0 });
  },

  back: () => {
    if (history.length > 1 && history.state?.route) history.back();
    else get().navigate('home', undefined, true);
  },

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    audio.sfxEnabled = settings.sfx;
    audio.setVolume(settings.volume);
    set({ settings });
    void getRepository().saveSettings(settings).catch(() => {});
  },

  recordAnswer: ({ itemKey, itemKeys, correct, ms, stage, level, fluentMs, skipLevel }) => {
    const now = Date.now();
    const { itemStats, levels } = get();
    const nextStats = { ...itemStats };
    for (const k of [...(itemKeys ?? []), ...(itemKey ? [itemKey] : [])]) {
      nextStats[k] = updateItemStat(itemStats[k], k, correct, ms, now, fluentMs);
      dirtyStats.add(k);
    }
    const id = levelId(stage, level);
    const nextLevels = skipLevel ? levels : { ...levels, [id]: recordLevelResult(levels[id], stage, level, correct, ms) };
    if (!skipLevel) dirtyLevels.add(id);
    set({ itemStats: nextStats, levels: nextLevels });
    scheduleFlush(get);
  },

  finishSession: (s, extra) => {
    const st = get();
    const now = Date.now();
    const day = dayKey(now);
    const record: SessionRecord = { ...s, date: now, day };
    const pbKey = `${s.stage}:${s.mode}:${s.level}`;
    const personalBest = s.score > (st.profile.personalBests[pbKey] ?? 0) && s.answers > 0;
    const lid = levelId(s.stage, s.level);
    const lp = st.levels[lid];
    const nowMastered = levelMastery(lp, st.settings.masteryThreshold).mastered;
    const prevMastered = extra?.wasMastered ?? nowMastered;
    const profile: Profile = {
      ...st.profile,
      xp: st.profile.xp + s.xp,
      practiceDays: st.profile.practiceDays.includes(day) ? st.profile.practiceDays : [...st.profile.practiceDays, day].slice(-400),
      personalBests: personalBest ? { ...st.profile.personalBests, [pbKey]: s.score } : st.profile.personalBests,
      totals: {
        answers: st.profile.totals.answers + s.answers,
        correct: st.profile.totals.correct + Math.round(s.answers * s.accuracy),
        sessions: st.profile.totals.sessions + 1,
        secondsPracticed: st.profile.totals.secondsPracticed + s.durationSec,
        phrases: st.profile.totals.phrases + (extra?.phrases ?? 0),
        perfectPhrases: st.profile.totals.perfectPhrases + (extra?.perfectPhrases ?? 0),
      },
    };
    const levels = lp ? { ...st.levels, [lid]: { ...lp, sessions: lp.sessions + 1, bestScore: Math.max(lp.bestScore, s.score) } } : st.levels;
    if (lp) dirtyLevels.add(lid);
    const unlocked = newlyUnlocked({ profile, session: record, itemStats: st.itemStats, levels, threshold: st.settings.masteryThreshold });
    unlocked.forEach((a) => (profile.achievements = { ...profile.achievements, [a.id]: now }));
    set({ profile, levels, sessions: [...st.sessions, record].slice(-400) });
    const repo = getRepository();
    void repo.saveProfile(profile).catch(() => {});
    void repo.addSession(record).catch(() => {});
    void flushNow(get);
    return { xpGained: s.xp, newAchievements: unlocked, newlyMastered: nowMastered && !prevMastered, personalBest };
  },

  showToast: (msg) => {
    set({ toast: msg });
    setTimeout(() => get().toast === msg && set({ toast: null }), 2600);
  },

  resetProgress: async () => {
    await getRepository().reset();
    const settings = { ...get().settings };
    await getRepository().saveSettings(settings);
    set({ profile: DEFAULT_PROFILE, itemStats: {}, levels: {}, sessions: [] });
  },
}));

export function useSettings() {
  return useStore((s) => s.settings);
}
