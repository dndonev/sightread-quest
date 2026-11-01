import { Award, Flame, RotateCcw, Sparkles, Trophy } from 'lucide-react';
import type { SessionScore } from '../game-engine/scoring';
import type { SessionOutcome } from '../state/store';
import { Button, Card, Stat, formatMs, pct } from './ui';

export function SessionResults({
  title,
  score,
  outcome,
  extra,
  onAgain,
  onDone,
  doneLabel = 'Done',
}: {
  title: string;
  score: Pick<SessionScore, 'final' | 'accuracy' | 'medianMs' | 'bestStreak' | 'total' | 'correct'>;
  outcome: SessionOutcome | null;
  extra?: React.ReactNode;
  onAgain?: () => void;
  onDone: () => void;
  doneLabel?: string;
}) {
  return (
    <div className="animate-fade-up space-y-4">
      <Card className="text-center">
        <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
          <Trophy size={28} />
        </div>
        <h2 className="text-xl font-bold">{title}</h2>
        <div className="tabular mt-1 text-4xl font-black text-accent">{score.final.toLocaleString()}</div>
        <div className="text-sm text-muted">points{outcome ? ` · +${outcome.xpGained} XP` : ''}</div>
        {outcome?.personalBest && (
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-warn/15 px-3 py-1 text-sm font-semibold text-warn">
            <Sparkles size={14} /> New personal best
          </div>
        )}
      </Card>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Accuracy" value={pct(score.accuracy)} sub={`${score.correct}/${score.total}`} />
        <Stat label="Median time" value={formatMs(score.medianMs)} sub="correct answers" />
        <Stat label="Best streak" value={<span className="inline-flex items-center gap-1"><Flame size={18} className="text-warn" />{score.bestStreak}</span>} />
        <Stat label="Answers" value={score.total} />
      </div>
      {extra}
      {outcome?.newlyMastered && (
        <Card className="border-good/40 bg-good/10">
          <p className="font-semibold text-good">Level mastered — the next level is unlocked.</p>
        </Card>
      )}
      {outcome?.newAchievements.map((a) => (
        <Card key={a.id} className="flex items-center gap-3 border-warn/40">
          <Award className="shrink-0 text-warn" />
          <div>
            <div className="font-semibold">Achievement: {a.title}</div>
            <div className="text-sm text-muted">{a.description}</div>
          </div>
        </Card>
      ))}
      <div className="grid grid-cols-2 gap-2">
        {onAgain && (
          <Button onClick={onAgain}>
            <RotateCcw size={18} /> Again
          </Button>
        )}
        <Button variant="primary" onClick={onDone} className={onAgain ? '' : 'col-span-2'}>
          {doneLabel}
        </Button>
      </div>
    </div>
  );
}
