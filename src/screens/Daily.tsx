import { useState } from 'react';
import { Check } from 'lucide-react';
import { useStore } from '../state/store';
import { Button, Card, Header, Slider, cx, pct } from '../components/ui';
import { NoteHunterGame } from '../stages/NoteHunterGame';
import { ChordDecoderGame } from '../stages/ChordDecoderGame';
import { SightReadingGame } from '../stages/SightReadingGame';
import { highestUnlocked } from './helpers';
import type { SessionScore } from '../game-engine/scoring';

type Segment = 'notes' | 'chords' | 'reading';
const ORDER: Segment[] = ['notes', 'chords', 'reading'];
const LABELS: Record<Segment, string> = { notes: 'Note recognition', chords: 'Chord recognition', reading: 'Sight-reading' };

export function DailyTraining() {
  const { settings, levels, updateSettings, back } = useStore();
  const [phase, setPhase] = useState<'setup' | 'run' | 'done'>('setup');
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<Partial<Record<Segment, SessionScore>>>({});
  const segs = ORDER.filter((s) => settings.daily[s] > 0);
  const lvl = (s: Segment) => (settings.unlockAll ? Math.max(1, highestUnlocked(levels, s, settings)) : highestUnlocked(levels, s, settings));
  const current = segs[idx];

  const complete = (seg: Segment, score: SessionScore) => {
    setResults((r) => ({ ...r, [seg]: score }));
  };
  const advance = () => {
    if (idx + 1 >= segs.length) setPhase('done');
    else setIdx(idx + 1);
  };

  return (
    <div>
      <Header title="Daily Training" subtitle={phase === 'run' ? `${idx + 1}/${segs.length} · ${LABELS[current]}` : `${settings.daily.notes + settings.daily.chords + settings.daily.reading} minutes`} />
      {phase === 'setup' && (
        <div className="space-y-3">
          <Card className="space-y-3">
            <p className="text-sm text-muted">A balanced routine at your current levels. Adjust the minutes for each part:</p>
            <Slider label="Note recognition" value={settings.daily.notes} min={0} max={10} onChange={(v) => updateSettings({ daily: { ...settings.daily, notes: v } })} format={(v) => `${v} min`} />
            <Slider label="Chord recognition" value={settings.daily.chords} min={0} max={10} onChange={(v) => updateSettings({ daily: { ...settings.daily, chords: v } })} format={(v) => `${v} min`} />
            <Slider label="Sight-reading" value={settings.daily.reading} min={0} max={15} onChange={(v) => updateSettings({ daily: { ...settings.daily, reading: v } })} format={(v) => `${v} min`} />
          </Card>
          <Card className="text-sm text-muted">
            Levels used: Note Hunter {lvl('notes')}, Chord Decoder {lvl('chords')}, Sight-Reading {lvl('reading')}. Note practice focuses on your weakest notes when you have enough history.
          </Card>
          <Button variant="primary" className="w-full" disabled={!segs.length} onClick={() => setPhase('run')}>
            Begin
          </Button>
        </div>
      )}
      {phase === 'run' && current && (
        <div key={current}>
          <div className="mb-3 flex gap-1.5">
            {segs.map((s, i) => (
              <div key={s} className={cx('h-1.5 flex-1 rounded-full', i < idx ? 'bg-good' : i === idx ? 'bg-accent' : 'bg-line')} />
            ))}
          </div>
          {current === 'notes' && (
            <NoteHunterGame level={lvl('notes')} mode={Object.keys(useStore.getState().itemStats).length > 30 ? 'weak' : 'practice'} timeLimitSec={settings.daily.notes * 60} onComplete={(s) => complete('notes', s)} onExit={advance} />
          )}
          {current === 'chords' && <ChordDecoderGame level={lvl('chords')} mode="name" timeLimitSec={settings.daily.chords * 60} onComplete={(s) => complete('chords', s)} onExit={advance} />}
          {current === 'reading' && (
            <SightReadingGame level={lvl('reading')} mode={settings.instrument === 'guitar' ? 'perform' : 'identify'} timeLimitSec={settings.daily.reading * 60} onComplete={(s) => complete('reading', s)} onExit={advance} />
          )}
        </div>
      )}
      {phase === 'done' && (
        <div className="space-y-3">
          <Card className="text-center">
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-good/20 text-good"><Check size={30} /></div>
            <h2 className="text-xl font-bold">Daily training complete</h2>
            <p className="text-sm text-muted">Nice work — your streak is safe for today.</p>
          </Card>
          {segs.map((s) => (
            <Card key={s} className="flex items-center justify-between">
              <span className="font-semibold">{LABELS[s]}</span>
              <span className="tabular text-sm text-muted">{results[s] ? `${pct(results[s]!.accuracy)} · ${results[s]!.final.toLocaleString()} pts` : 'skipped'}</span>
            </Card>
          ))}
          <Button variant="primary" className="w-full" onClick={back}>
            Back home
          </Button>
        </div>
      )}
    </div>
  );
}
