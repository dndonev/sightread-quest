import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Heart, Timer, Zap } from 'lucide-react';
import { useStore } from '../state/store';
import { createRng } from '../music-theory/random';
import { type Accidental, type Letter, displayName, midi } from '../music-theory/pitch';
import {
  type NoteHunterConfig,
  type NoteQuestion,
  checkNoteAnswer,
  clefsFor,
  explainNote,
  generateNoteQuestion,
  levelConfig,
  octaveChoices,
} from '../game-engine/noteHunter';
import { ScoreKeeper, type SessionScore } from '../game-engine/scoring';
import { levelMastery } from '../adaptive-learning/mastery';
import { NoteStaff } from '../components/notation';
import { LetterPad } from '../components/instruments';
import { SessionResults } from '../components/SessionResults';
import { Button, Card, Pill, Progress, cx, formatMs, pct } from '../components/ui';
import { ACCENT, INK } from '../notation/render';
import { audio } from '../audio/engine';
import { describePosition, positionsForMidi } from '../music-theory/guitar';
import type { SessionOutcome } from '../state/store';
import type { Clef } from '../notation/staff';

export type NoteMode = 'practice' | 'sprint' | 'survival' | 'weak' | 'ladder';

export const NOTE_MODES: { id: NoteMode; title: string; description: string }[] = [
  { id: 'practice', title: 'Practice', description: 'Unlimited, no time pressure.' },
  { id: 'sprint', title: 'Sprint', description: '60 seconds — accuracy first, then speed.' },
  { id: 'survival', title: 'Survival', description: 'Three lives. How far can you go?' },
  { id: 'weak', title: 'Weak notes', description: 'Targets the notes you miss most.' },
  { id: 'ladder', title: 'Speed ladder', description: 'The answer window shrinks as you stay accurate.' },
];

interface Props {
  level: number;
  mode: NoteMode;
  timeLimitSec?: number;
  custom?: Partial<Pick<NoteHunterConfig, 'customRange' | 'customAccidentals' | 'customClef'>>;
  onComplete?: (score: SessionScore, outcome: SessionOutcome) => void;
  onExit: () => void;
}

interface Feedback {
  correct: boolean;
  chosen?: { letter: Letter; accidental: Accidental; octave?: number };
  timeout?: boolean;
  points: number;
}

export function NoteHunterGame({ level, mode, timeLimitSec, custom, onComplete, onExit }: Props) {
  const settings = useStore((s) => s.settings);
  const recordAnswer = useStore((s) => s.recordAnswer);
  const finishSession = useStore((s) => s.finishSession);
  const lvl = levelConfig(level);
  const cfg: NoteHunterConfig = useMemo(
    () => ({ level, instrument: settings.instrument, preferredClef: settings.clef, octaveRecognition: settings.octaveRecognition, ...custom }),
    [level, settings.instrument, settings.clef, settings.octaveRecognition, custom],
  );
  const rng = useMemo(() => createRng(), []);
  const keeper = useRef(new ScoreKeeper());
  const startedAt = useRef(0);
  const wasMastered = useRef(false);
  const [phase, setPhase] = useState<'ready' | 'playing' | 'done'>('ready');
  const [q, setQ] = useState<NoteQuestion | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const shownAt = useRef(0);
  const [lives, setLives] = useState(3);
  const limit = timeLimitSec ?? (mode === 'sprint' ? 60 : undefined);
  const [timeLeft, setTimeLeft] = useState(limit ?? 0);
  const baseWindow = lvl.answerWindowMs ?? (mode === 'ladder' ? 3000 : undefined);
  const [windowMs, setWindowMs] = useState(baseWindow);
  const ladderRun = useRef(0);
  const [result, setResult] = useState<{ score: SessionScore; outcome: SessionOutcome } | null>(null);
  const [, force] = useState(0);
  const windowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const next = useCallback(
    (prev?: NoteQuestion | null) => {
      const stats = useStore.getState().itemStats;
      const nq = generateNoteQuestion(cfg, rng, stats, Date.now(), { previous: prev ?? undefined, weakOnly: mode === 'weak' });
      setQ(nq);
      setFeedback(null);
      shownAt.current = performance.now();
    },
    [cfg, rng, mode],
  );

  const finish = useCallback(() => {
    if (windowTimer.current) clearTimeout(windowTimer.current);
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    const score = keeper.current.summary();
    const outcome = finishSession(
      {
        stage: 'notes',
        mode,
        level,
        score: score.final,
        accuracy: score.accuracy,
        medianMs: score.medianMs,
        answers: score.total,
        xp: score.xp,
        durationSec: Math.round((performance.now() - startedAt.current) / 1000),
      },
      { wasMastered: wasMastered.current },
    );
    if (outcome.newlyMastered || outcome.newAchievements.length) audio.sfx('level');
    setResult({ score, outcome });
    setPhase('done');
    onComplete?.(score, outcome);
  }, [finishSession, level, mode, onComplete]);

  const start = async () => {
    await audio.unlock().catch(() => {});
    keeper.current = new ScoreKeeper();
    wasMastered.current = levelMastery(useStore.getState().levels[`notes:${level}`], settings.masteryThreshold).mastered;
    startedAt.current = performance.now();
    setLives(3);
    setTimeLeft(limit ?? 0);
    setWindowMs(baseWindow);
    ladderRun.current = 0;
    setResult(null);
    setPhase('playing');
    next(null);
  };

  // Session timer
  useEffect(() => {
    if (phase !== 'playing' || !limit) return;
    const id = setInterval(() => {
      const left = limit - (performance.now() - startedAt.current) / 1000;
      setTimeLeft(Math.max(0, left));
      if (left <= 0) {
        clearInterval(id);
        finish();
      }
    }, 100);
    return () => clearInterval(id);
  }, [phase, limit, finish]);

  const answer = useCallback(
    (a: { letter: Letter; accidental: Accidental; octave?: number } | null) => {
      if (!q || feedback || phase !== 'playing') return;
      if (windowTimer.current) clearTimeout(windowTimer.current);
      const ms = performance.now() - shownAt.current;
      const correct = a ? checkNoteAnswer(q, a, { octaveRecognition: settings.octaveRecognition, instrument: settings.instrument, octaveLabels: settings.octaveLabels }) : false;
      const points = keeper.current.record(correct, ms);
      recordAnswer({ itemKey: q.itemKey, correct, ms, stage: 'notes', level, fluentMs: 1500 });
      const sounding = midi(q.target) - (settings.instrument === 'guitar' && q.clef === 'treble' ? 12 : 0);
      if (correct) {
        if (settings.sfx) audio.playMidi([sounding], 0.6);
      } else {
        audio.sfx('wrong');
        if (settings.sfx) setTimeout(() => audio.playMidi([sounding], 0.8), 200);
      }
      setFeedback({ correct, chosen: a ?? undefined, timeout: !a, points });
      if (mode === 'ladder' && windowMs) {
        if (correct) {
          ladderRun.current++;
          if (ladderRun.current >= 5) {
            ladderRun.current = 0;
            setWindowMs(Math.max(700, Math.round(windowMs * 0.85)));
          }
        } else {
          ladderRun.current = 0;
          setWindowMs(Math.min(3000, Math.round(windowMs * 1.15)));
        }
      }
      let livesLeft = lives;
      if (!correct && mode === 'survival') {
        livesLeft = lives - 1;
        setLives(livesLeft);
      }
      force((n) => n + 1);
      const auto = correct ? 380 : mode === 'practice' || mode === 'weak' ? null : 1500;
      if (mode === 'survival' && livesLeft <= 0) {
        advanceTimer.current = setTimeout(finish, 1400);
        return;
      }
      if (auto !== null) advanceTimer.current = setTimeout(() => next(q), auto);
    },
    [q, feedback, phase, settings, recordAnswer, level, mode, windowMs, lives, next, finish],
  );

  // Per-question answer window (rapid level / speed ladder)
  useEffect(() => {
    if (phase !== 'playing' || !q || feedback || !windowMs) return;
    windowTimer.current = setTimeout(() => answer(null), windowMs);
    return () => {
      if (windowTimer.current) clearTimeout(windowTimer.current);
    };
  }, [q, feedback, windowMs, phase, answer]);

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      if (windowTimer.current) clearTimeout(windowTimer.current);
    },
    [],
  );

  const summary = keeper.current.summary();
  const clefs: Clef[] = clefsFor(cfg);
  const guitar = settings.instrument === 'guitar';

  if (phase === 'done' && result) {
    return (
      <SessionResults
        title={mode === 'survival' ? 'Out of lives' : 'Session complete'}
        score={result.score}
        outcome={result.outcome}
        onAgain={onComplete ? undefined : start}
        onDone={onExit}
        doneLabel={onComplete ? 'Continue' : 'Done'}
      />
    );
  }

  if (phase === 'ready') {
    return (
      <Card className="animate-fade-up space-y-3 text-center">
        <Pill className="mx-auto">Level {level} · {NOTE_MODES.find((m) => m.id === mode)?.title}</Pill>
        <h2 className="text-xl font-bold">{lvl.title}</h2>
        <p className="text-muted">{custom?.customRange ? `Custom range ${custom.customRange.join('–')}` : lvl.description}</p>
        <p className="text-sm text-faint">
          {clefs.map((c) => (c === 'treble' ? (guitar ? 'Treble (guitar, sounds 8vb)' : 'Treble') : 'Bass')).join(' + ')} clef
          {settings.octaveRecognition ? ' · octave recognition on' : ''}
        </p>
        <Button variant="primary" className="w-full" onClick={start} autoFocus>
          Start
        </Button>
      </Card>
    );
  }

  if (!q) return null;
  const target = q.target;
  const notes = [
    ...q.context.map((c) => ({ pitches: [c.pitch], printed: [c.printed], duration: 'q', color: INK })),
    { pitches: [target], printed: [q.printed], duration: q.context.length ? 'q' : 'w', color: q.context.length ? ACCENT : INK },
  ];
  const octaves = settings.octaveRecognition ? octaveChoices(cfg, q.clef, settings.octaveLabels) : undefined;
  const guitarPositions = guitar && q.clef === 'treble' ? positionsForMidi(midi(target) - 12) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Pill className="tabular">
          <Zap size={12} className="text-accent" /> {summary.rawPoints.toLocaleString()}
        </Pill>
        <Pill className="tabular">🔥 {keeper.current.currentStreak}</Pill>
        <Pill className="tabular">{summary.total ? pct(summary.accuracy) : '—'}</Pill>
        <div className="flex-1" />
        {mode === 'survival' && (
          <div className="flex gap-0.5" aria-label={`${lives} lives`}>
            {[0, 1, 2].map((i) => (
              <Heart key={i} size={18} className={i < lives ? 'fill-bad text-bad' : 'text-line'} />
            ))}
          </div>
        )}
        {limit && (
          <Pill className={cx('tabular', timeLeft < 10 && 'text-warn')}>
            <Timer size={12} /> {Math.ceil(timeLeft)}s
          </Pill>
        )}
      </div>
      {windowMs && !feedback && <WindowBar key={q.id} ms={windowMs} />}
      <Card className={cx('relative px-2 py-3', feedback && (feedback.correct ? 'animate-pop ring-2 ring-good/60' : 'animate-shake ring-2 ring-bad/60'))}>
        <NoteStaff
          notes={notes}
          clef={q.clef}
          keyFifths={q.keyFifths}
          guitar8vb={guitar && q.clef === 'treble'}
          height={190}
          label={q.context.length ? 'Measure with key signature; identify the highlighted last note' : 'Identify the note'}
        />
        {q.context.length > 0 && <p className="text-center text-xs text-muted">Name the highlighted (last) note — mind the key signature and earlier accidentals.</p>}
      </Card>

      <div className="min-h-[72px]" aria-live="polite">
        {feedback && (
          <div className={cx('animate-fade-up rounded-2xl border px-3 py-2', feedback.correct ? 'border-good/40 bg-good/10' : 'border-bad/40 bg-bad/10')}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={cx('text-lg font-bold', feedback.correct ? 'text-good' : 'text-bad')}>
                {feedback.correct ? 'Correct' : feedback.timeout ? 'Too slow' : 'Not quite'} — {displayName(target, settings.naming, settings.octaveRecognition)}
                {guitar && settings.octaveRecognition && q.clef === 'treble' && (
                  <span className="ml-1 text-sm font-normal text-muted">(written {target.octave}, sounds {target.octave - 1})</span>
                )}
              </span>
              <span className="tabular text-sm text-muted">{feedback.correct ? `+${feedback.points}` : ''}</span>
            </div>
            {!feedback.correct && <p className="text-sm text-ink/90">{explainNote(q, settings.naming)}</p>}
            {!feedback.correct && guitarPositions.length > 0 && (
              <p className="mt-1 text-xs text-muted">On guitar: {guitarPositions.map(describePosition).join(' · ')}</p>
            )}
          </div>
        )}
        {!feedback && <p className="pt-4 text-center text-sm text-faint">Response target: under {formatMs(settings.experience === 'advanced' ? 800 : settings.experience === 'intermediate' ? 1500 : 3000)}</p>}
      </div>

      <LetterPad
        key={q.id}
        onAnswer={(letter, accidental, octave) => answer({ letter, accidental, octave })}
        naming={settings.naming}
        accidentals={q.requireAccidental}
        octaves={octaves}
        disabled={!!feedback}
        feedback={feedback ? { correct: target.letter, chosen: feedback.chosen?.letter } : null}
      />
      <div className="flex gap-2">
        {feedback && !feedback.correct && (mode === 'practice' || mode === 'weak') && (
          <Button variant="primary" className="flex-1" onClick={() => next(q)} autoFocus>
            Next
          </Button>
        )}
        {!limit && (
          <Button variant="ghost" className="flex-1" onClick={finish} disabled={summary.total === 0}>
            Finish session
          </Button>
        )}
      </div>
    </div>
  );
}

function WindowBar({ ms }: { ms: number }) {
  const [v, setV] = useState(1);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const loop = () => {
      const left = 1 - (performance.now() - start) / ms;
      setV(Math.max(0, left));
      if (left > 0) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ms]);
  return (
    <div>
      <Progress value={v} tone={v < 0.3 ? 'warn' : 'accent'} />
      <div className="mt-0.5 text-right text-[10px] text-faint">window {formatMs(ms)}</div>
    </div>
  );
}
