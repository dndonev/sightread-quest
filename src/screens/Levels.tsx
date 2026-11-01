import { useState } from 'react';
import { Check, Lock } from 'lucide-react';
import { useStore } from '../state/store';
import { Button, Card, Header, Progress, Segmented, cx, formatMs, pct } from '../components/ui';
import { type StageId, isLevelUnlocked, levelId, levelMastery } from '../adaptive-learning/mastery';
import { STAGES, fluencyMs, highestUnlocked } from './helpers';
import { NOTE_MODES } from '../stages/NoteHunterGame';
import { CHORD_MODES } from '../game-engine/chordDecoder';
import { READING_MODES } from '../stages/SightReadingGame';

export function StageSelect() {
  const navigate = useStore((s) => s.navigate);
  return (
    <div>
      <Header title="Choose a stage" />
      <div className="space-y-3">
        {STAGES.map((s, i) => (
          <Card key={s.id} onClick={() => navigate('levels', { stage: s.id })} className="py-5">
            <div className="text-xs font-bold uppercase tracking-widest text-accent">Stage {i + 1}</div>
            <div className="text-xl font-bold">{s.title}</div>
            <div className="text-sm text-muted">{s.subtitle}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function LevelSelect({ stage }: { stage: StageId }) {
  const { settings, levels, navigate, profile } = useStore();
  const st = STAGES.find((s) => s.id === stage) ?? STAGES[0];
  const [selected, setSelected] = useState(() => highestUnlocked(levels, stage, settings));
  const modes =
    stage === 'notes'
      ? NOTE_MODES.map((m) => ({ id: m.id as string, title: m.title, description: m.description }))
      : stage === 'chords'
        ? CHORD_MODES.filter((m) => !m.guitarOnly || settings.instrument === 'guitar').map((m) => ({ id: m.id as string, title: m.title, description: m.description }))
        : READING_MODES.map((m) => ({ id: m.id as string, title: m.title, description: m.description }));
  const [mode, setMode] = useState(modes[0].id);
  const fl = fluencyMs(settings, stage);
  const modeInfo = modes.find((m) => m.id === mode)!;

  return (
    <div className="pb-28">
      <Header title={st.title} subtitle={st.subtitle} />
      <div className="space-y-2">
        {st.levels.map((l) => {
          const unlocked = isLevelUnlocked(levels, stage, l.level, settings.masteryThreshold, settings.unlockAll, fl);
          const m = levelMastery(levels[levelId(stage, l.level)], settings.masteryThreshold, fl);
          return (
            <button
              key={l.level}
              disabled={!unlocked}
              onClick={() => setSelected(l.level)}
              className={cx(
                'flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition',
                selected === l.level ? 'border-accent bg-accent/10' : 'border-line bg-panel/70',
                !unlocked && 'opacity-50',
              )}
            >
              <div className={cx('tabular flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-black', m.mastered ? 'bg-good/20 text-good' : 'bg-panel-2 text-ink')}>
                {m.mastered ? <Check size={20} /> : unlocked ? l.level : <Lock size={16} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold">{l.title}</span>
                  {m.samples > 0 && <span className="tabular shrink-0 text-xs text-muted">{pct(m.accuracy)}{stage === 'notes' && m.medianMs ? ` · ${formatMs(m.medianMs)}` : ''}</span>}
                </div>
                <div className="truncate text-xs text-muted">{l.description}</div>
                {unlocked && <Progress value={m.mastered ? 1 : m.progress} className="mt-1.5 h-1" tone={m.mastered ? 'good' : 'accent'} />}
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-center text-xs text-faint">
        A level is mastered at {pct(settings.masteryThreshold)} accuracy over the last 20 {stage === 'reading' ? 'phrases' : 'answers'}
        {fl ? ` with a median under ${formatMs(fl)}` : ''}. Personal best: {profile.personalBests[`${stage}:${mode}:${selected}`]?.toLocaleString() ?? '—'}
      </p>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 px-4 pt-3 backdrop-blur" style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}>
        <div className="mx-auto max-w-2xl space-y-2">
          <div className="no-scrollbar -mx-4 overflow-x-auto px-4">
            <Segmented value={mode} onChange={setMode} options={modes.map((m) => ({ value: m.id, label: m.title.replace(/^[A-E] · /, '') }))} className="w-max min-w-full flex-nowrap" />
          </div>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-xs text-muted">{modeInfo.description}</p>
            <Button variant="primary" onClick={() => navigate(st.screen, { level: selected, mode })}>
              Play level {selected}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
