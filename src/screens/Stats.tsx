import { Award, Lock } from 'lucide-react';
import { useStore } from '../state/store';
import { Card, Header, Progress, Section, Stat, cx, formatMs, pct } from '../components/ui';
import { ACHIEVEMENTS, currentStreak, dayKey, longestStreak } from '../game-engine/progress';
import { levelFromXp, median } from '../game-engine/scoring';
import { mastery, medianTime, accuracy } from '../adaptive-learning/mastery';
import { STAGES, stageMastery } from './helpers';
import { diatonicIndex, displayName, fromDiatonicIndex, parsePitch } from '../music-theory/pitch';
import type { SessionRecord } from '../persistence/types';
import { CHORD_QUALITIES, type ChordQuality } from '../music-theory/chords';

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - i)));
  return out;
}

function TrendChart({ values, labels, format, color = '#2dd4bf', height = 90, invert }: { values: (number | null)[]; labels: string[]; format: (v: number) => string; color?: string; height?: number; invert?: boolean }) {
  const w = 320;
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v !== null) as { v: number; i: number }[];
  if (pts.length === 0) return <p className="py-6 text-center text-sm text-faint">No data yet — finish a session to see trends.</p>;
  const max = Math.max(...pts.map((p) => p.v));
  const min = Math.min(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => 8 + (i / Math.max(1, values.length - 1)) * (w - 16);
  const y = (v: number) => {
    const t = (v - min) / span;
    return 10 + (invert ? t : 1 - t) * (height - 26);
  };
  const path = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label={`Trend; latest ${format(last.v)}`}>
      <path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p) => (
        <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={3} fill={color} />
      ))}
      <text x={x(last.i)} y={Math.max(10, y(last.v) - 8)} textAnchor="end" fontSize={11} fill="#e8eef7" fontWeight={700}>
        {format(last.v)}
      </text>
      <text x={8} y={height - 2} fontSize={9} fill="#64748b">{labels[0]}</text>
      <text x={w - 8} y={height - 2} fontSize={9} fill="#64748b" textAnchor="end">{labels[labels.length - 1]}</text>
    </svg>
  );
}

function byDay(sessions: SessionRecord[], days: string[], pick: (s: SessionRecord[]) => number | null) {
  return days.map((d) => {
    const list = sessions.filter((s) => s.day === d);
    return list.length ? pick(list) : null;
  });
}

export function Statistics() {
  const { profile, sessions, itemStats, levels, settings } = useStore();
  const days = lastNDays(14);
  const lv = levelFromXp(profile.xp);
  const weighted = (list: SessionRecord[]) => {
    const n = list.reduce((s, x) => s + x.answers, 0);
    return n ? list.reduce((s, x) => s + x.accuracy * x.answers, 0) / n : null;
  };
  const noteSessions = sessions.filter((s) => s.stage === 'notes');
  const accTrend = byDay(sessions.filter((s) => s.stage !== 'reading'), days, weighted);
  const rtTrend = byDay(noteSessions, days, (l) => {
    const m = median(l.filter((x) => x.medianMs > 0).map((x) => x.medianMs));
    return m || null;
  });
  const minutes = days.map((d) => sessions.filter((s) => s.day === d).reduce((m, s) => m + s.durationSec / 60, 0));
  const maxMin = Math.max(settings.dailyGoalMin, ...minutes);
  const calendar = lastNDays(56);
  const practiced = new Set(profile.practiceDays);

  // Staff heat map: treble E3/A3..C6
  const low = diatonicIndex(parsePitch(settings.instrument === 'guitar' ? 'E3' : 'A3'));
  const high = diatonicIndex(parsePitch('C6'));
  const notes = Array.from({ length: high - low + 1 }, (_, i) => fromDiatonicIndex(low + i));
  const chordKeys = (Object.keys(CHORD_QUALITIES) as ChordQuality[]).filter((q) => itemStats[`chord:${q}`]);
  const rhythmKeys = Object.keys(itemStats).filter((k) => k.startsWith('rhythm:') && itemStats[k].attempts > 2);

  return (
    <div className="pb-6">
      <Header title="Statistics" subtitle={`Level ${lv.level} · ${profile.xp.toLocaleString()} XP`} />
      <div className="mb-5 grid grid-cols-2 gap-2">
        <Stat label="Current streak" value={`${currentStreak(profile.practiceDays)} d`} sub={`best ${longestStreak(profile.practiceDays)} d`} />
        <Stat label="Practice time" value={`${Math.round(profile.totals.secondsPracticed / 60)} min`} sub={`${profile.totals.sessions} sessions`} />
        <Stat label="Lifetime accuracy" value={profile.totals.answers ? pct(profile.totals.correct / profile.totals.answers) : '—'} sub={`${profile.totals.answers.toLocaleString()} answers`} />
        <Stat label="Phrases read" value={profile.totals.phrases} sub={`${profile.totals.perfectPhrases} clean`} />
      </div>

      <Section title="Stage mastery">
        <Card className="space-y-3">
          {STAGES.map((s) => {
            const m = stageMastery(levels, s.id, settings);
            return (
              <div key={s.id}>
                <div className="flex justify-between text-sm"><span>{s.title}</span><span className="tabular text-muted">{pct(m)}</span></div>
                <Progress value={m} />
              </div>
            );
          })}
        </Card>
      </Section>

      <Section title="Accuracy · last 14 days">
        <Card><TrendChart values={accTrend} labels={days.map((d) => d.slice(5))} format={pct} /></Card>
      </Section>
      <Section title="Note reaction time · last 14 days">
        <Card><TrendChart values={rtTrend} labels={days.map((d) => d.slice(5))} format={formatMs} color="#38bdf8" invert /></Card>
      </Section>

      <Section title="Daily practice (minutes)">
        <Card>
          <div className="flex h-24 items-end gap-1">
            {minutes.map((m, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div className={cx('w-full rounded-t', m >= settings.dailyGoalMin ? 'bg-good' : 'bg-accent/70')} style={{ height: `${(m / maxMin) * 80}px`, minHeight: m > 0 ? 3 : 0 }} title={`${days[i]}: ${m.toFixed(1)} min`} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-faint"><span>{days[0].slice(5)}</span><span>today</span></div>
          <div className="mt-3 grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1" aria-label="Practice calendar, last 8 weeks">
            {calendar.map((d) => (
              <div key={d} title={d} className={cx('aspect-square rounded-sm', practiced.has(d) ? 'bg-accent' : 'bg-line')} />
            ))}
          </div>
        </Card>
      </Section>

      <Section title="Note mastery (treble)">
        <Card>
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
            {notes.map((p) => {
              const s = itemStats[`note:treble:${p.letter}${p.octave}`];
              const m = mastery(s);
              const bg = !s ? 'bg-line/50 text-faint' : m >= 0.8 ? 'bg-good/25 text-good' : m >= 0.5 ? 'bg-warn/20 text-warn' : 'bg-bad/20 text-bad';
              return (
                <div key={`${p.letter}${p.octave}`} className={cx('rounded-lg px-1 py-1.5 text-center', bg)} title={s ? `${pct(accuracy(s))} · ${formatMs(medianTime(s))}` : 'not practised'}>
                  <div className="text-sm font-bold">{displayName(p, settings.naming, true)}</div>
                  <div className="tabular text-[10px]">{s ? formatMs(medianTime(s)) : '—'}</div>
                </div>
              );
            })}
          </div>
        </Card>
      </Section>

      {chordKeys.length > 0 && (
        <Section title="Chord qualities">
          <Card className="space-y-2">
            {chordKeys.map((q) => (
              <div key={q}>
                <div className="flex justify-between text-sm"><span>{CHORD_QUALITIES[q].name}</span><span className="tabular text-muted">{pct(accuracy(itemStats[`chord:${q}`]))}</span></div>
                <Progress value={mastery(itemStats[`chord:${q}`], 4000)} className="h-1.5" />
              </div>
            ))}
          </Card>
        </Section>
      )}

      {rhythmKeys.length > 0 && (
        <Section title="Rhythm patterns">
          <Card className="grid grid-cols-2 gap-2">
            {rhythmKeys.map((k) => (
              <div key={k} className="flex items-center justify-between rounded-lg bg-panel-2 px-2 py-1 text-sm">
                <span className="font-mono text-xs">{k.split(':')[2]}</span>
                <span className="tabular text-muted">{pct(accuracy(itemStats[k]))}</span>
              </div>
            ))}
          </Card>
        </Section>
      )}

      <Section title="Personal bests">
        <Card className="space-y-1 text-sm">
          {Object.entries(profile.personalBests).length === 0 && <p className="text-faint">None yet.</p>}
          {Object.entries(profile.personalBests)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([k, v]) => {
              const [stage, mode, level] = k.split(':');
              return (
                <div key={k} className="flex justify-between">
                  <span>{STAGES.find((s) => s.id === stage)?.title} · L{level} · {mode}</span>
                  <span className="tabular font-semibold text-accent">{v.toLocaleString()}</span>
                </div>
              );
            })}
        </Card>
      </Section>

      <Section title={`Achievements · ${Object.keys(profile.achievements).length}/${ACHIEVEMENTS.length}`}>
        <div className="grid grid-cols-2 gap-2">
          {ACHIEVEMENTS.map((a) => {
            const got = !!profile.achievements[a.id];
            return (
              <Card key={a.id} className={cx('p-3', !got && 'opacity-50')}>
                <div className="flex items-center gap-2 font-semibold">{got ? <Award size={16} className="text-warn" /> : <Lock size={14} />} {a.title}</div>
                <div className="text-xs text-muted">{a.description}</div>
              </Card>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
