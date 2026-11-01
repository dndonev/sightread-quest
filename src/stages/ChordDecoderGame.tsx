import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Timer, Volume2, Zap } from 'lucide-react';
import { useStore, type SessionOutcome } from '../state/store';
import { createRng } from '../music-theory/random';
import {
  type ChordMode,
  type ChordQuestion,
  type Voicing,
  CHORD_MODES,
  checkComponents,
  chordLevel,
  generateChordQuestion,
} from '../game-engine/chordDecoder';
import { CHORD_QUALITIES, type ChordQuality, INVERSION_NAMES, type RootClass } from '../music-theory/chords';
import { displayName, sameSpelledClass } from '../music-theory/pitch';
import { ScoreKeeper, type SessionScore } from '../game-engine/scoring';
import { levelMastery } from '../adaptive-learning/mastery';
import { ChordSequence, NoteStaff } from '../components/notation';
import { FretDiagram } from '../components/instruments';
import { SessionResults } from '../components/SessionResults';
import { Button, Card, Pill, cx, pct } from '../components/ui';
import { audio } from '../audio/engine';

interface Props {
  level: number;
  mode: ChordMode;
  timeLimitSec?: number;
  onComplete?: (score: SessionScore, outcome: SessionOutcome) => void;
  onExit: () => void;
}

function VoicingStaff({ v, guitar, height = 200, label }: { v: Voicing; guitar: boolean; height?: number; label: string }) {
  return (
    <NoteStaff
      notes={[{ pitches: v.notes.map((n) => n.pitch), printed: v.notes.map((n) => (n.pitch.accidental === 0 ? null : n.pitch.accidental)) }]}
      clef="treble"
      grand={v.staff === 'grand'}
      guitar8vb={guitar}
      height={v.staff === 'grand' ? 250 : height}
      label={label}
    />
  );
}

export function ChordDecoderGame({ level, mode, timeLimitSec, onComplete, onExit }: Props) {
  const settings = useStore((s) => s.settings);
  const recordAnswer = useStore((s) => s.recordAnswer);
  const finishSession = useStore((s) => s.finishSession);
  const guitar = settings.instrument === 'guitar';
  const effectiveMode: ChordMode = mode === 'fretboard' && !guitar ? 'name' : mode;
  const rng = useMemo(() => createRng(), []);
  const keeper = useRef(new ScoreKeeper());
  const startedAt = useRef(0);
  const wasMastered = useRef(false);
  const shownAt = useRef(0);
  const [phase, setPhase] = useState<'ready' | 'playing' | 'done'>('ready');
  const [q, setQ] = useState<ChordQuestion | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [comp, setComp] = useState<{ root?: RootClass; quality?: ChordQuality; inversion?: number }>({});
  const [compResult, setCompResult] = useState<ReturnType<typeof checkComponents> | null>(null);
  const [result, setResult] = useState<{ score: SessionScore; outcome: SessionOutcome } | null>(null);
  const [timeLeft, setTimeLeft] = useState(timeLimitSec ?? 0);
  const lvl = chordLevel(level);

  const playQuestion = useCallback((cq: ChordQuestion) => {
    if (cq.progression) {
      const t = audio.now() + 0.05;
      cq.progression.chords.forEach((c, i) => audio.playMidi(c.sounding, 1.1, t + i * 1.2, 0.6));
    } else audio.playChord(cq.voicing.sounding);
  }, []);

  const next = useCallback(() => {
    const stats = useStore.getState().itemStats;
    const nq = generateChordQuestion({ level, mode: effectiveMode, instrument: settings.instrument, naming: settings.naming }, rng, stats, Date.now(), { previousKey: q?.itemKey });
    setQ(nq);
    setChosen(null);
    setComp({});
    setCompResult(null);
    shownAt.current = performance.now();
    if (effectiveMode === 'hear') setTimeout(() => playQuestion(nq), 150);
  }, [level, effectiveMode, settings.instrument, settings.naming, rng, q, playQuestion]);

  const finish = useCallback(() => {
    const score = keeper.current.summary();
    const outcome = finishSession(
      { stage: 'chords', mode: effectiveMode, level, score: score.final, accuracy: score.accuracy, medianMs: score.medianMs, answers: score.total, xp: score.xp, durationSec: Math.round((performance.now() - startedAt.current) / 1000) },
      { wasMastered: wasMastered.current },
    );
    if (outcome.newlyMastered || outcome.newAchievements.length) audio.sfx('level');
    setResult({ score, outcome });
    setPhase('done');
    onComplete?.(score, outcome);
  }, [finishSession, effectiveMode, level, onComplete]);

  useEffect(() => {
    if (phase !== 'playing' || !timeLimitSec) return;
    const id = setInterval(() => {
      const left = timeLimitSec - (performance.now() - startedAt.current) / 1000;
      setTimeLeft(Math.max(0, left));
      if (left <= 0) {
        clearInterval(id);
        finish();
      }
    }, 200);
    return () => clearInterval(id);
  }, [phase, timeLimitSec, finish]);

  const start = async () => {
    await audio.unlock().catch(() => {});
    keeper.current = new ScoreKeeper();
    wasMastered.current = levelMastery(useStore.getState().levels[`chords:${level}`], settings.masteryThreshold).mastered;
    startedAt.current = performance.now();
    setResult(null);
    setPhase('playing');
    next();
  };

  const grade = (correct: boolean) => {
    if (!q) return;
    const ms = performance.now() - shownAt.current;
    keeper.current.record(correct, ms);
    recordAnswer({ itemKey: q.itemKey, correct, ms, stage: 'chords', level, fluentMs: 4000 });
    if (correct) audio.sfx('correct');
    else audio.sfx('wrong');
    if (!correct || effectiveMode !== 'hear') setTimeout(() => playQuestion(q), correct ? 120 : 400);
  };

  const choose = (i: number) => {
    if (!q || chosen !== null) return;
    setChosen(i);
    grade(i === q.correctIndex);
  };

  const submitComponents = () => {
    if (!q || !comp.root || !comp.quality || compResult) return;
    const r = checkComponents(q, comp.root, comp.quality, comp.inversion ?? 0);
    setCompResult(r);
    grade(r.all);
  };

  if (phase === 'done' && result) {
    return <SessionResults title="Session complete" score={result.score} outcome={result.outcome} onAgain={onComplete ? undefined : start} onDone={onExit} doneLabel={onComplete ? 'Continue' : 'Done'} />;
  }

  if (phase === 'ready') {
    const m = CHORD_MODES.find((x) => x.id === effectiveMode)!;
    return (
      <Card className="animate-fade-up space-y-3 text-center">
        <Pill className="mx-auto">Level {level} · {m.title}</Pill>
        <h2 className="text-xl font-bold">{effectiveMode === 'progression' ? 'Progressions' : lvl.title}</h2>
        <p className="text-muted">{effectiveMode === 'progression' ? 'Recognise common progressions written in a key.' : lvl.description}</p>
        <p className="text-sm text-faint">{m.description}</p>
        <Button variant="primary" className="w-full" onClick={start} autoFocus>
          Start
        </Button>
      </Card>
    );
  }
  if (!q) return null;
  const answered = chosen !== null || compResult !== null;
  const correct = chosen !== null ? chosen === q.correctIndex : compResult?.all;
  const summary = keeper.current.summary();
  const showStaff = effectiveMode !== 'hear' || answered;
  const n = settings.naming;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Pill className="tabular"><Zap size={12} className="text-accent" /> {summary.rawPoints.toLocaleString()}</Pill>
        <Pill className="tabular">🔥 {keeper.current.currentStreak}</Pill>
        <Pill className="tabular">{summary.total ? pct(summary.accuracy) : '—'}</Pill>
        <div className="flex-1" />
        {timeLimitSec && <Pill className="tabular"><Timer size={12} /> {Math.ceil(timeLeft)}s</Pill>}
      </div>

      <Card className={cx('px-2 py-3', answered && (correct ? 'ring-2 ring-good/60' : 'ring-2 ring-bad/60'))}>
        <div className="mb-1 flex items-center justify-between px-2">
          <h2 className="font-semibold">{q.prompt}</h2>
          <button onClick={() => playQuestion(q)} aria-label="Play chord" className="flex h-11 w-11 items-center justify-center rounded-full bg-panel-2 text-accent">
            <Volume2 size={20} />
          </button>
        </div>
        {q.context && <p className="px-2 text-sm text-accent-2">{q.context}</p>}
        {q.progression ? (
          <ChordSequence chords={q.progression.chords.map((c) => c.notes.map((x) => x.pitch))} clef="treble" keyFifths={q.progression.key.fifths} guitar8vb={guitar} label="Chord progression" />
        ) : showStaff ? (
          <VoicingStaff v={q.voicing} guitar={guitar} label="Chord to identify" />
        ) : (
          <div className="flex h-40 items-center justify-center text-muted">Listen to the chord, then pick its notation.</div>
        )}
        {answered && q.progression && <p className="px-2 text-center text-sm text-muted">{q.progression.labels.join('  ·  ')}</p>}
      </Card>

      {effectiveMode === 'components' && q.components ? (
        <ComponentsPicker q={q} value={comp} onChange={setComp} result={compResult} naming={n} />
      ) : (
        <div className={cx('grid gap-2', effectiveMode === 'hear' || effectiveMode === 'fretboard' ? 'grid-cols-2' : 'grid-cols-2')}>
          {q.options.map((o, i) => {
            const isRight = answered && i === q.correctIndex;
            const isWrong = answered && i === chosen && i !== q.correctIndex;
            return (
              <button
                key={i}
                onClick={() => choose(i)}
                disabled={answered}
                className={cx(
                  'flex min-h-16 flex-col items-center justify-center rounded-2xl border px-2 py-2 text-lg font-bold transition active:scale-[0.98]',
                  isRight ? 'border-good bg-good/15 text-good' : isWrong ? 'border-bad bg-bad/15 text-bad' : 'border-line bg-panel-2 hover:border-accent/60',
                )}
              >
                {effectiveMode === 'hear' && o.voicing ? (
                  <div className="pointer-events-none w-full">
                    <VoicingStaff v={o.voicing} guitar={guitar} height={130} label={`Option ${i + 1}`} />
                    {answered && <div className="text-sm">{o.label}</div>}
                  </div>
                ) : effectiveMode === 'fretboard' && o.voicing?.fingering ? (
                  <div className="pointer-events-none flex flex-col items-center">
                    <FretDiagram fingering={o.voicing.fingering} />
                    {answered && <div className="text-sm">{o.label}</div>}
                  </div>
                ) : (
                  <span className={effectiveMode === 'progression' ? 'text-sm' : ''}>{o.label}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {answered && (
        <div className={cx('animate-fade-up rounded-2xl border px-3 py-2 text-sm', correct ? 'border-good/40 bg-good/10' : 'border-bad/40 bg-bad/10')} aria-live="polite">
          <div className={cx('font-bold', correct ? 'text-good' : 'text-bad')}>{correct ? 'Correct' : 'Not quite'}</div>
          <p>{q.explanation}</p>
          {guitar && q.voicing.fingering && effectiveMode !== 'fretboard' && !q.progression && (
            <div className="mt-2 flex items-center gap-3">
              <FretDiagram fingering={q.voicing.fingering} size={0.9} />
              <span className="text-xs text-muted">One playable fingering (sounds an octave below the written chord).</span>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        {effectiveMode === 'components' && !compResult && (
          <Button variant="primary" className="flex-1" onClick={submitComponents} disabled={!comp.root || !comp.quality || (q.components!.inversions.length > 1 && comp.inversion === undefined)}>
            Check
          </Button>
        )}
        {answered && (
          <Button variant="primary" className="flex-1" onClick={next} autoFocus>
            Next
          </Button>
        )}
        {!timeLimitSec && (
          <Button variant="ghost" onClick={finish} disabled={summary.total === 0}>
            Finish
          </Button>
        )}
      </div>
    </div>
  );
}

function ComponentsPicker({ q, value, onChange, result, naming }: { q: ChordQuestion; value: { root?: RootClass; quality?: ChordQuality; inversion?: number }; onChange: (v: typeof value) => void; result: ReturnType<typeof checkComponents> | null; naming: 'english' | 'solfege' }) {
  const c = q.components!;
  const opt = (selected: boolean, ok: boolean | undefined, isAnswer: boolean) =>
    cx(
      'min-h-12 rounded-xl border px-2 text-sm font-semibold',
      result ? (isAnswer ? 'border-good bg-good/15 text-good' : selected && !ok ? 'border-bad bg-bad/15 text-bad' : 'border-line bg-panel-2 text-muted') : selected ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel-2',
    );
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs uppercase tracking-wider text-faint">Root</div>
        <div className="grid grid-cols-4 gap-1.5">
          {c.roots.map((r, i) => (
            <button key={i} disabled={!!result} onClick={() => onChange({ ...value, root: r })} className={opt(!!value.root && sameSpelledClass(value.root, r), result?.root, sameSpelledClass(r, q.answer.root))}>
              {displayName(r, naming)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs uppercase tracking-wider text-faint">Quality</div>
        <div className="grid grid-cols-2 gap-1.5">
          {c.qualities.map((ql) => (
            <button key={ql} disabled={!!result} onClick={() => onChange({ ...value, quality: ql })} className={opt(value.quality === ql, result?.quality, ql === q.answer.quality)}>
              {CHORD_QUALITIES[ql].name}
            </button>
          ))}
        </div>
      </div>
      {c.inversions.length > 1 && (
        <div>
          <div className="mb-1 text-xs uppercase tracking-wider text-faint">Inversion</div>
          <div className="grid grid-cols-2 gap-1.5">
            {c.inversions.map((inv) => (
              <button key={inv} disabled={!!result} onClick={() => onChange({ ...value, inversion: inv })} className={opt(value.inversion === inv, result?.inversion, inv === c.answerInversion)}>
                {INVERSION_NAMES[inv]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
