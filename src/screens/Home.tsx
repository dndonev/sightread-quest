import { BarChart3, Calendar, ChevronRight, Flame, FlaskConical, Music, Music2, Music4, Settings as SettingsIcon, Sparkles, Target } from 'lucide-react';
import { useStore } from '../state/store';
import { Card, Progress, Section, cx, pct } from '../components/ui';
import { currentStreak } from '../game-engine/progress';
import { levelFromXp } from '../game-engine/scoring';
import { STAGES, greeting, highestUnlocked, minutesToday, stageMastery } from './helpers';
import { mastery, weakestItems } from '../adaptive-learning/mastery';
import { parsePitch, displayName } from '../music-theory/pitch';

const STAGE_ICONS = { notes: Music, chords: Music4, reading: Music2 };

export function Home() {
  const { settings, profile, levels, sessions, itemStats, navigate } = useStore();
  const streak = currentStreak(profile.practiceDays);
  const lv = levelFromXp(profile.xp);
  const today = minutesToday(sessions);
  const goal = settings.dailyGoalMin;
  const noteKeys = Object.keys(itemStats).filter((k) => k.startsWith('note:') && !k.includes('@'));
  const weak = weakestItems(noteKeys, (k) => k, itemStats, 4).filter((k) => mastery(itemStats[k]) < 0.8);

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-start justify-between" style={{ paddingTop: 'calc(var(--safe-top) + 16px)' }}>
        <div>
          <p className="text-sm text-muted">{greeting()}</p>
          <h1 className="bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-2xl font-black text-transparent">SightRead Quest</h1>
        </div>
        <button aria-label="Settings" onClick={() => navigate('settings')} className="flex h-11 w-11 items-center justify-center rounded-full bg-panel-2 text-muted hover:text-ink">
          <SettingsIcon size={20} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3">
          <div className="flex items-center gap-1 text-xs text-faint"><Flame size={14} className="text-warn" />Streak</div>
          <div className="tabular text-2xl font-black">{streak}<span className="ml-1 text-sm font-medium text-muted">d</span></div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-1 text-xs text-faint"><Sparkles size={14} className="text-accent" />Level</div>
          <div className="tabular text-2xl font-black">{lv.level}</div>
          <Progress value={lv.into / lv.needed} className="mt-1 h-1.5" />
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-1 text-xs text-faint"><Target size={14} className="text-accent-2" />Today</div>
          <div className="tabular text-2xl font-black">{Math.floor(today)}<span className="ml-1 text-sm font-medium text-muted">/{goal}m</span></div>
          <Progress value={today / goal} className="mt-1 h-1.5" tone={today >= goal ? 'good' : 'accent'} />
        </Card>
      </div>

      <Card onClick={() => navigate('daily')} className="relative overflow-hidden border-accent/40 bg-gradient-to-br from-accent/15 via-panel to-accent-2/10">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-slate-950"><Calendar size={24} /></div>
          <div className="flex-1">
            <div className="text-lg font-bold">Daily Training</div>
            <div className="text-sm text-muted">
              {settings.daily.notes}′ notes · {settings.daily.chords}′ chords · {settings.daily.reading}′ sight-reading
            </div>
          </div>
          <ChevronRight className="text-accent" />
        </div>
      </Card>

      <Section title="Stages">
        <div className="space-y-2">
          {STAGES.map((s) => {
            const Icon = STAGE_ICONS[s.id];
            const m = stageMastery(levels, s.id, settings);
            const hi = highestUnlocked(levels, s.id, settings);
            return (
              <Card key={s.id} onClick={() => navigate('levels', { stage: s.id })}>
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-panel-2 text-accent"><Icon size={22} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between">
                      <span className="font-bold">{s.title}</span>
                      <span className="tabular text-xs text-muted">{pct(m)} mastered</span>
                    </div>
                    <div className="truncate text-xs text-muted">{settings.unlockAll ? 'All levels open' : `Level ${hi} unlocked`} · {s.subtitle}</div>
                    <Progress value={m} className="mt-2 h-1.5" />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </Section>

      {weak.length > 0 && (
        <Section title="Notes to review">
          <Card onClick={() => navigate('notes', { level: settings.unlockAll ? 5 : highestUnlocked(levels, 'notes', settings), mode: 'weak' })}>
            <div className="flex items-center gap-2">
              <div className="flex flex-1 flex-wrap gap-1.5">
                {weak.map((k) => {
                  const [, clef, p] = k.split(':');
                  return (
                    <span key={k} className="rounded-lg bg-bad/10 px-2 py-1 text-sm font-semibold text-bad">
                      {displayName(parsePitch(p), settings.naming, true)} <span className="text-[10px] font-normal text-muted">{clef}</span>
                    </span>
                  );
                })}
              </div>
              <span className="text-sm font-semibold text-accent">Drill</span>
              <ChevronRight size={18} className="text-accent" />
            </div>
          </Card>
        </Section>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Card onClick={() => navigate('lab')} className="flex items-center gap-2">
          <FlaskConical className="text-accent-2" size={20} /> <span className="font-semibold">Practice Lab</span>
        </Card>
        <Card onClick={() => navigate('stats')} className="flex items-center gap-2">
          <BarChart3 className="text-accent" size={20} /> <span className="font-semibold">Statistics</span>
        </Card>
      </div>
      <p className={cx('text-center text-xs text-faint')}>{profile.totals.sessions} sessions · {profile.totals.correct.toLocaleString()} correct answers</p>
    </div>
  );
}
