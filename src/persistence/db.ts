import Dexie, { type Table } from 'dexie';
import type { ItemStat, LevelProgress } from '../adaptive-learning/mastery';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Profile, type SessionRecord, type Settings } from './types';

interface KV {
  key: string;
  value: unknown;
}

export class SightReadDB extends Dexie {
  kv!: Table<KV, string>;
  itemStats!: Table<ItemStat, string>;
  levels!: Table<LevelProgress, string>;
  sessions!: Table<SessionRecord, number>;

  constructor(name = 'sightread-quest') {
    super(name);
    this.version(1).stores({
      kv: 'key',
      itemStats: 'key, category, dueAt',
      levels: 'id, stage',
      sessions: '++id, date, day, stage',
    });
  }
}

export interface PersistedState {
  settings: Settings;
  profile: Profile;
  itemStats: Record<string, ItemStat>;
  levels: Record<string, LevelProgress>;
  sessions: SessionRecord[];
}

function mergeSettings(s: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    daily: { ...DEFAULT_SETTINGS.daily, ...s?.daily },
    mic: { ...DEFAULT_SETTINGS.mic, ...s?.mic },
  };
}

function mergeProfile(p: Partial<Profile> | undefined): Profile {
  return { ...DEFAULT_PROFILE, ...p, totals: { ...DEFAULT_PROFILE.totals, ...p?.totals } };
}

export class Repository {
  constructor(readonly db: SightReadDB) {}

  async load(): Promise<PersistedState> {
    const [settings, profile, stats, levels, sessions] = await Promise.all([
      this.db.kv.get('settings'),
      this.db.kv.get('profile'),
      this.db.itemStats.toArray(),
      this.db.levels.toArray(),
      this.db.sessions.orderBy('date').reverse().limit(400).toArray(),
    ]);
    return {
      settings: mergeSettings(settings?.value as Partial<Settings>),
      profile: mergeProfile(profile?.value as Partial<Profile>),
      itemStats: Object.fromEntries(stats.map((s) => [s.key, s])),
      levels: Object.fromEntries(levels.map((l) => [l.id, l])),
      sessions: sessions.reverse(),
    };
  }

  saveSettings(s: Settings) {
    return this.db.kv.put({ key: 'settings', value: s });
  }

  saveProfile(p: Profile) {
    return this.db.kv.put({ key: 'profile', value: p });
  }

  saveItemStats(stats: ItemStat[]) {
    return this.db.itemStats.bulkPut(stats);
  }

  saveLevels(levels: LevelProgress[]) {
    return this.db.levels.bulkPut(levels);
  }

  addSession(s: SessionRecord) {
    return this.db.sessions.add(s);
  }

  async reset() {
    await Promise.all([this.db.kv.clear(), this.db.itemStats.clear(), this.db.levels.clear(), this.db.sessions.clear()]);
  }
}

let repo: Repository | null = null;
export function getRepository(): Repository {
  if (!repo) repo = new Repository(new SightReadDB());
  return repo;
}
