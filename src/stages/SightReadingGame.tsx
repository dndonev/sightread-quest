import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Headphones, Mic, Pause, Play, Repeat, RotateCcw, SkipForward, Timer } from 'lucide-react';
import { useStore, type SessionOutcome } from '../state/store';
import { createRng } from '../music-theory/random';
import { type Accidental, type Letter, displayName, midi } from '../music-theory/pitch';
import { type Exercise, generateExercise, melodyPitch, onsetEvents, readingLevel, rhythmItemKey, soundingTicks } from '../game-engine/sightReading';
import {
  type IdentifyAnswer,
  type PlayedNote,
  type Tap,
  activeIdentifyEvent,
  evaluateIdentify,
  evaluatePerformance,
  evaluateRhythm,
  gradeFor,
  measureBreakdown,
  octaveErrorHint,
  timingFeedback,
  toleranceFor,
} from '../game-engine/evaluation';
import { phraseScore, median, type SessionScore } from '../game-engine/scoring';
import { levelMastery } from '../adaptive-learning/mastery';
import { ScoreClock } from '../audio/clock';
import { audio } from '../audio/engine';
import { MicPitchTracker, type MicError } from '../pitch-detection/mic';
import { ScoreView, type ScoreViewHandle } from '../components/notation';
import { Fretboard, LetterPad, Piano, TapPad } from '../components/instruments';
import { SessionResults } from '../components/SessionResults';
import { Button, Card, Pill, Segmented, Slider, Toggle, cx, pct } from '../components/ui';
import { BAD, GOOD, WARN } from '../notation/render';
import { noteItemKey } from '../game-engine/noteHunter';

export type ReadingMode = 'identify' | 'rhythm' | 'perform' | 'mic' | 'readahead';

export const READING_MODES: { id: ReadingMode; title: string; description: string }[] = [
  { id: 'identify', title: 'A · Read & identify', description: 'Name each note as the playhead reaches it.' },
  { id: 'rhythm', title: 'B · Rhythm trainer', description: 'Tap (and hold) the rhythm in time.' },
  { id: 'perform', title: 'C · Melody performance', description: 'Play it on the virtual fretboard or keyboard.' },
  { id: 'mic', title: 'D · Real instrument', description: 'Play your guitar or piano into the microphone (single notes).' },
  { id: 'readahead', title: 'E · Read ahead', description: 'The current beat is hidden — read the next bar early.' },
];

interface Props {
  level: number;
  mode: ReadingMode;
  timeLimitSec?: number;
  measures?: number;
  onComplete?: (score: SessionScore, outcome: SessionOutcome) => void;
  onExit: () => void;
}

type Phase = 'ready' | 'preview' | 'playing' | 'paused' | 'listening' | 'review' | 'done';

interface PhraseResult {
  performance: number;
  timing: number;
  points: number;
  grade: string;
  lines: string[];
  colors: Map<number, string>;
  correctNotes: number;
  expected: number;
  offsetsMs: number[];
  bestRun: number;
  detail: string;
}

export function SightReadingGame({ level, mode, timeLimitSec, measures, onComplete, onExit }: Props) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const recordAnswer = useStore((s) => s.recordAnswer);
  const finishSession = useStore((s) => s.finishSession);
  const showToast = useStore((s) => s.showToast);
  const guitar = settings.instrument === 'guitar';
  const clef = guitar ? 'treble' : settings.clef === 'bass' ? 'bass' : 'treble';
  const lvl = readingLevel(level);
  const rng = useMemo(() => createRng(), []);
  const newExercise = useCallback(
    () => generateExercise({ level, instrument: settings.instrument, clef, measures, stats: useStore.getState().itemStats }, rng),
    [level, settings.instrument, clef, measures, rng],
  );
  const [exercise, setExercise] = useState<Exercise>(() => newExercise());
  const [tempo, setTempo] = useState(lvl.tempo);
  const [loop, setLoop] = useState(false);
  const [phase, setPhase] = useState<Phase>('ready');
  const [previewLeft, setPreviewLeft] = useState(0);
  const [result, setResult] = useState<PhraseResult | null>(null);
  const [colors, setColors] = useState<Map<number, string> | undefined>(undefined);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [lastAnswer, setLastAnswer] = useState<{ id: number; ok: boolean; letter: Letter } | null>(null);
  const [inputDevice, setInputDevice] = useState<'fretboard' | 'piano'>(guitar ? 'fretboard' : 'piano');
  const [micState, setMicState] = useState<{ on: boolean; error?: MicError; level: number; midi: number | null }>({ on: false, level: 0, midi: null });
  const [sessionDone, setSessionDone] = useState<{ score: SessionScore; outcome: SessionOutcome } | null>(null);

  const scoreRef = useRef<ScoreViewHandle>(null);
  const clockRef = useRef<ScoreClock | null>(null);
  const rafRef = useRef(0);
  const taps = useRef<Tap[]>([]);
  const played = useRef<PlayedNote[]>([]);
  const answers = useRef<IdentifyAnswer[]>([]);
  const holdStart = useRef<{ tick: number; idx: number } | null>(null);
  const micRef = useRef<MicPitchTracker | null>(null);
  const session = useRef({ start: 0, phrases: 0, perfect: 0, points: 0, xp: 0, correct: 0, expected: 0, offsets: [] as number[], bestRun: 0, wasMastered: false });
  const phaseRef = useRef<Phase>('ready');
  phaseRef.current = phase;

  const requireAccidental = level >= 4;
  const transpose = guitar && clef === 'treble' ? -12 : 0;

  /* ---------- animation ---------- */
  const animate = useCallback(() => {
    const clock = clockRef.current;
    if (!clock) return;
    const tick = clock.currentTick();
    const ex = exercise;
    const identifyLike = mode === 'identify' || mode === 'readahead';
    const active = identifyLike ? activeIdentifyEvent(ex, tick) : undefined;
    scoreRef.current?.update(tick, {
      highlightId: identifyLike && mode === 'identify' ? active?.id ?? null : null,
      mask: mode === 'readahead' && tick >= 0,
      lookAhead: mode === 'readahead' && tick >= 0,
    });
    if (identifyLike) setActiveId((prev) => (prev === (active?.id ?? null) ? prev : active?.id ?? null));
    rafRef.current = requestAnimationFrame(animate);
  }, [exercise, mode]);

  const stopAnim = () => cancelAnimationFrame(rafRef.current);

  /* ---------- evaluation ---------- */
  const evaluate = useCallback(() => {
    stopAnim();
    const ex = exercise;
    const clock = clockRef.current!;
    const tol = toleranceFor(tempo, ex);
    const mspt = clock.msPerTick;
    const colorMap = new Map<number, string>();
    let performance = 0;
    let timing = 0;
    let correctNotes = 0;
    let bestRun = 0;
    const lines: string[] = [];
    const offsetsMs: number[] = [];
    const expected = onsetEvents(ex);
    let detail = '';

    const runOf = (statuses: boolean[]) => {
      let r = 0;
      let b = 0;
      for (const s of statuses) {
        r = s ? r + 1 : 0;
        b = Math.max(b, r);
      }
      return b;
    };

    if (mode === 'rhythm') {
      const r = evaluateRhythm(ex, taps.current, tol);
      performance = r.accuracy;
      timing = r.timing;
      correctNotes = r.hits;
      r.notes.forEach((n) => {
        colorMap.set(n.eventId, n.status === 'hit' ? (Math.abs(n.offsetTicks!) <= tol.perfectTicks ? GOOD : WARN) : BAD);
        if (n.offsetTicks !== undefined) offsetsMs.push(Math.abs(n.offsetTicks * mspt));
        const ev = ex.events.find((e) => e.id === n.eventId)!;
        if (ev.cell) recordAnswer({ itemKey: rhythmItemKey(ev.cell, ex.timeSig), correct: n.status === 'hit', ms: 500 + Math.abs((n.offsetTicks ?? tol.hitTicks) * mspt) * 4, stage: 'reading', level, skipLevel: true, fluentMs: 1000 });
      });
      bestRun = runOf(r.notes.map((n) => n.status === 'hit'));
      detail = `${r.hits}/${r.expected} onsets · ${r.extraTaps} extra tap${r.extraTaps === 1 ? '' : 's'}${r.durationAccuracy !== null ? ` · held values ${pct(r.durationAccuracy)} accurate` : ''}`;
      const tf = timingFeedback(r.meanOffsetTicks, tol, mspt);
      if (tf) lines.push(tf);
      if (r.extraTaps > 1) lines.push('Extra taps cost points — rests and ties need silence.');
      lines.push(...measureBreakdown(ex, r.notes, 'hit'));
    } else if (mode === 'perform' || mode === 'mic') {
      const r = evaluatePerformance(ex, played.current, tol, transpose);
      performance = r.pitchAccuracy;
      timing = r.timing;
      correctNotes = r.correct;
      r.notes.forEach((n) => {
        colorMap.set(n.eventId, n.status === 'correct' ? GOOD : n.status === 'missed' ? WARN : BAD);
        if (n.offsetTicks !== undefined && n.status === 'correct') offsetsMs.push(Math.abs(n.offsetTicks * mspt));
        const ev = ex.events.find((e) => e.id === n.eventId)!;
        recordAnswer({ itemKey: noteItemKey(ex.clef, melodyPitch(ev)), correct: n.status === 'correct', ms: 600 + Math.abs((n.offsetTicks ?? tol.hitTicks) * mspt) * 3, stage: 'reading', level, skipLevel: true });
      });
      bestRun = Math.round(r.continuity * r.expected);
      detail = `${r.correct}/${r.expected} correct · ${r.extraNotes} extra · continuity ${pct(r.continuity)}${r.durationAccuracy !== null ? ` · durations ${pct(r.durationAccuracy)}` : ''}`;
      const oh = octaveErrorHint(r.notes, settings.instrument);
      if (oh) lines.push(oh);
      const wrong = r.notes.filter((n) => n.status === 'wrong-pitch').length;
      if (wrong) lines.push(`${wrong} wrong pitch${wrong > 1 ? 'es' : ''} — check key signature and accidentals.`);
      const tf = timingFeedback(r.meanOffsetTicks, tol, mspt);
      if (tf) lines.push(tf);
      lines.push(...measureBreakdown(ex, r.notes, 'correct'));
    } else {
      const r = evaluateIdentify(ex, answers.current, requireAccidental);
      performance = r.accuracy;
      correctNotes = r.correct;
      r.notes.forEach((n) => {
        colorMap.set(n.eventId, n.status === 'correct' ? GOOD : n.status === 'missed' ? WARN : BAD);
        const ev = ex.events.find((e) => e.id === n.eventId)!;
        const lateness = n.answeredTick !== undefined ? Math.max(0, n.answeredTick - ev.start) * mspt : soundingTicks(ex, ev) * mspt;
        if (n.answeredTick !== undefined) offsetsMs.push(lateness);
        recordAnswer({ itemKey: noteItemKey(ex.clef, melodyPitch(ev)), correct: n.status === 'correct', ms: Math.max(150, lateness), stage: 'reading', level, skipLevel: true });
      });
      const answered = r.notes.filter((n) => n.answeredTick !== undefined);
      timing = answered.length ? Math.max(0, 1 - median(offsetsMs) / 1000) : 0;
      bestRun = runOf(r.notes.map((n) => n.status === 'correct'));
      const missed = r.notes.filter((n) => n.status === 'missed').length;
      detail = `${r.correct}/${r.expected} named correctly · ${missed} missed`;
      if (missed > 2) lines.push(mode === 'readahead' ? 'Read further ahead: name the hidden note from memory of the bar.' : 'Missed notes: try a slower tempo until every note gets an answer.');
      lines.push(...measureBreakdown(ex, r.notes, 'correct'));
    }
    const { final, xp } = phraseScore(performance, timing);
    const perfect = correctNotes === expected.length && performance >= 0.999;
    recordAnswer({ correct: performance >= settings.masteryThreshold, ms: median(offsetsMs), stage: 'reading', level });
    if (perfect) lines.unshift('Clean read — no mistakes!');
    if (performance >= 0.9 && tempo < 200) lines.push(`Ready for more? Try ${Math.min(200, tempo + 8)} BPM.`);
    if (performance < 0.6 && tempo > 40) lines.push(`Try ${Math.max(40, tempo - 10)} BPM and keep going without stopping.`);
    const s = session.current;
    s.phrases++;
    if (perfect) s.perfect++;
    s.points += final;
    s.xp += xp;
    s.correct += correctNotes;
    s.expected += expected.length;
    s.offsets.push(...offsetsMs);
    s.bestRun = Math.max(s.bestRun, bestRun);
    audio.sfx(performance >= 0.75 ? 'correct' : 'wrong');
    setColors(colorMap);
    setResult({ performance, timing, points: final, grade: gradeFor(performance), lines, colors: colorMap, correctNotes, expected: expected.length, offsetsMs, bestRun, detail });
    setPhase('review');
    scoreRef.current?.update(-1e9);
  }, [exercise, tempo, mode, recordAnswer, level, settings.instrument, settings.masteryThreshold, requireAccidental, transpose]);

  /* ---------- transport ---------- */
  const begin = useCallback(
    (ex: Exercise) => {
      taps.current = [];
      played.current = [];
      answers.current = [];
      holdStart.current = null;
      setColors(undefined);
      setResult(null);
      setLastAnswer(null);
      clockRef.current?.stop();
      const clock = new ScoreClock({
        bpm: tempo,
        timeSig: ex.timeSig,
        totalTicks: ex.totalTicks,
        countInMeasures: 1,
        metronome: settings.metronome,
        onEnd: () => {
          if (phaseRef.current === 'playing') evaluate();
        },
      });
      clockRef.current = clock;
      clock.start(0);
      setPhase('playing');
      stopAnim();
      rafRef.current = requestAnimationFrame(animate);
    },
    [tempo, settings.metronome, evaluate, animate],
  );

  // Preview countdown
  useEffect(() => {
    if (phase !== 'preview') return;
    if (previewLeft <= 0) {
      begin(exercise);
      return;
    }
    const id = setTimeout(() => setPreviewLeft((p) => p - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, previewLeft, begin, exercise]);

  const previewSeconds = Math.min(10, 3 + Math.ceil(exercise.measures.length * 0.8));

  const startPreview = () => {
    setPreviewLeft(previewSeconds);
    setColors(undefined);
    setResult(null);
    setPhase('preview');
    scoreRef.current?.update(-1e9);
  };

  const startSession = async () => {
    await audio.unlock().catch(() => {});
    session.current = { start: performance.now(), phrases: 0, perfect: 0, points: 0, xp: 0, correct: 0, expected: 0, offsets: [], bestRun: 0, wasMastered: levelMastery(useStore.getState().levels[`reading:${level}`], settings.masteryThreshold).mastered };
    if (mode === 'mic' && !micState.on) {
      const ok = await enableMic();
      if (!ok) return;
    }
    startPreview();
  };

  const timeUp = () => !!timeLimitSec && (performance.now() - session.current.start) / 1000 >= timeLimitSec;

  const nextPhrase = () => {
    if (timeUp()) return finishAll();
    const ex = newExercise();
    setExercise(ex);
    startPreview();
  };

  const replay = () => {
    if (timeUp()) return finishAll();
    begin(exercise);
  };

  // Loop: auto-replay the same phrase after review
  useEffect(() => {
    if (phase !== 'review' || !loop) return;
    const id = setTimeout(() => replay(), 2500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, loop]);

  const togglePause = () => {
    const c = clockRef.current;
    if (!c) return;
    if (phase === 'playing') {
      c.pause();
      stopAnim();
      setPhase('paused');
    } else if (phase === 'paused') {
      c.resume();
      setPhase('playing');
      rafRef.current = requestAnimationFrame(animate);
    }
  };

  const listen = async () => {
    await audio.unlock().catch(() => {});
    clockRef.current?.stop();
    const ex = exercise;
    const clock = new ScoreClock({
      bpm: tempo,
      timeSig: ex.timeSig,
      totalTicks: ex.totalTicks,
      countInMeasures: 1,
      metronome: settings.metronome,
      playback: onsetEvents(ex).map((e) => ({ tick: e.start, ticks: soundingTicks(ex, e), midis: e.pitches.map((p) => midi(p) + transpose) })),
      onEnd: () => {
        stopAnim();
        setPhase((p) => (p === 'listening' ? (result ? 'review' : 'ready') : p));
        scoreRef.current?.update(-1e9);
      },
    });
    clockRef.current = clock;
    clock.start(0);
    setPhase('listening');
    stopAnim();
    rafRef.current = requestAnimationFrame(animate);
  };

  const finishAll = useCallback(() => {
    clockRef.current?.stop();
    stopAnim();
    micRef.current?.stop();
    const s = session.current;
    const accuracy = s.expected ? s.correct / s.expected : 0;
    const score: SessionScore = { total: s.expected, correct: s.correct, accuracy, rawPoints: s.points, final: s.points, xp: s.xp, medianMs: median(s.offsets), bestStreak: s.bestRun };
    const outcome = finishSession(
      { stage: 'reading', mode, level, score: s.points, accuracy, medianMs: score.medianMs, answers: s.phrases, xp: s.xp, durationSec: Math.round((performance.now() - s.start) / 1000) },
      { phrases: s.phrases, perfectPhrases: s.perfect, wasMastered: s.wasMastered },
    );
    if (outcome.newlyMastered || outcome.newAchievements.length) audio.sfx('level');
    setSessionDone({ score, outcome });
    setPhase('done');
    onComplete?.(score, outcome);
  }, [finishSession, mode, level, onComplete]);

  // Pause when the app is backgrounded or audio is interrupted (calls, Siri, lock screen…)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden' && phaseRef.current === 'playing') togglePauseRef.current();
    };
    document.addEventListener('visibilitychange', onVis);
    const off = audio.onStateChange((st) => {
      if (st !== 'running' && phaseRef.current === 'playing') {
        togglePauseRef.current();
        showToast('Audio was interrupted — tap Resume to continue.');
      }
    });
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      off();
    };
  }, [showToast]);
  const togglePauseRef = useRef(togglePause);
  togglePauseRef.current = togglePause;

  useEffect(
    () => () => {
      clockRef.current?.stop();
      stopAnim();
      micRef.current?.stop();
    },
    [],
  );

  /* ---------- inputs ---------- */
  const nowTick = () => clockRef.current?.tickAt(audio.now()) ?? 0;
  const acceptingInput = phase === 'playing';

  const onTapDown = useCallback(() => {
    if (phaseRef.current !== 'playing') return;
    const tick = clockRef.current!.tickAt(audio.now());
    taps.current.push({ tick });
    holdStart.current = { tick, idx: taps.current.length - 1 };
    navigator.vibrate?.(8);
  }, []);
  const onTapUp = useCallback(() => {
    const h = holdStart.current;
    if (!h || !clockRef.current) return;
    taps.current[h.idx].holdTicks = clockRef.current.tickAt(audio.now()) - h.tick;
    holdStart.current = null;
  }, []);

  const pressNote = (m: number) => {
    audio.playMidi([m], 0.9);
    if (phaseRef.current !== 'playing') return;
    const tick = nowTick();
    played.current.push({ tick, midi: m });
    holdStart.current = { tick, idx: played.current.length - 1 };
  };
  const releaseNote = () => {
    const h = holdStart.current;
    if (!h || !clockRef.current) return;
    if (played.current[h.idx]) played.current[h.idx].holdTicks = nowTick() - h.tick;
    holdStart.current = null;
  };

  const identify = (letter: Letter, accidental: Accidental) => {
    if (phaseRef.current !== 'playing') return;
    const tick = nowTick();
    const ev = activeIdentifyEvent(exercise, tick);
    if (!ev) return;
    if (answers.current.some((a) => activeIdentifyEvent(exercise, a.tick)?.id === ev.id)) return;
    answers.current.push({ tick, letter, accidental });
    const p = melodyPitch(ev);
    const ok = p.letter === letter && (!requireAccidental || p.accidental === accidental);
    setLastAnswer({ id: ev.id, ok, letter: p.letter });
  };

  async function enableMic(): Promise<boolean> {
    await audio.unlock().catch(() => {});
    micRef.current?.stop();
    const tracker = new MicPitchTracker({
      confidence: settings.mic.confidence,
      noiseFloor: settings.mic.noiseFloor,
      latencyMs: settings.mic.latencyMs,
      onNoteOn: (n) => {
        if (phaseRef.current !== 'playing' || !clockRef.current) return;
        played.current.push({ tick: clockRef.current.tickAt(n.time), midi: n.midi });
      },
      onNoteOff: (n) => {
        const last = played.current[played.current.length - 1];
        if (last && last.midi === n.midi && clockRef.current && last.holdTicks === undefined) last.holdTicks = clockRef.current.tickAt(n.time) - last.tick;
      },
      onLevel: (lv, m) => setMicState((s) => (Math.abs(s.level - lv) > 0.004 || s.midi !== m ? { ...s, level: lv, midi: m } : s)),
    });
    const err = await tracker.start();
    if (err) {
      setMicState({ on: false, error: err, level: 0, midi: null });
      return false;
    }
    micRef.current = tracker;
    setMicState({ on: true, level: 0, midi: null });
    return true;
  }

  /* ---------- render ---------- */
  if (phase === 'done' && sessionDone) {
    return (
      <SessionResults
        title="Sight-reading session"
        score={sessionDone.score}
        outcome={sessionDone.outcome}
        extra={<p className="text-center text-sm text-muted">{session.current.phrases} phrase{session.current.phrases === 1 ? '' : 's'} · {session.current.perfect} clean</p>}
        onAgain={onComplete ? undefined : () => { setSessionDone(null); setPhase('ready'); }}
        onDone={onExit}
        doneLabel={onComplete ? 'Continue' : 'Done'}
      />
    );
  }

  const modeInfo = READING_MODES.find((m) => m.id === mode)!;
  const running = phase === 'playing' || phase === 'paused' || phase === 'listening';
  const activeEv = activeId !== null ? exercise.events.find((e) => e.id === activeId) : null;
  const elapsed = session.current.start ? (performance.now() - session.current.start) / 1000 : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill>L{level}</Pill>
        <Pill>{exercise.title}</Pill>
        {exercise.source && <Pill className="text-accent-2">Real tune</Pill>}
        <div className="flex-1" />
        {timeLimitSec && session.current.start > 0 && (
          <Pill className="tabular"><Timer size={12} /> {Math.max(0, Math.ceil(timeLimitSec - elapsed))}s</Pill>
        )}
      </div>

      <div data-score-scroll className="max-h-[46vh] overflow-y-auto rounded-3xl border border-line bg-panel/80 px-1 py-2 sm:max-h-none">
        <ScoreView ref={scoreRef} exercise={exercise} guitar8vb={guitar && clef === 'treble'} showTab={guitar && settings.showTab} colors={colors} />
      </div>

      {phase === 'ready' && (
        <Card className="animate-fade-up space-y-3">
          <div>
            <h2 className="text-lg font-bold">{modeInfo.title}</h2>
            <p className="text-sm text-muted">{modeInfo.description} {lvl.description}</p>
          </div>
          {mode === 'mic' && (
            <MicPanel state={micState} onEnable={enableMic} confidence={settings.mic.confidence} />
          )}
          <Slider label="Tempo" value={tempo} min={40} max={200} onChange={setTempo} format={(v) => `${v} BPM`} />
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={listen}><Headphones size={18} /> Listen</Button>
            <Button variant="primary" onClick={startSession} autoFocus>
              <Play size={18} /> Start
            </Button>
          </div>
        </Card>
      )}

      {phase === 'preview' && (
        <Card className="flex items-center gap-3">
          <div className="tabular flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-accent text-xl font-bold text-accent">{previewLeft}</div>
          <div className="flex-1 text-sm">
            <div className="font-semibold">Preview the phrase</div>
            <div className="text-muted">Scan the key, meter, rhythms and tricky spots. One bar count-in follows.</div>
          </div>
          <Button variant="primary" onClick={() => begin(exercise)}>Go</Button>
        </Card>
      )}

      {running && (
        <div className="flex items-center gap-2">
          <Button onClick={togglePause} disabled={phase === 'listening'} aria-label={phase === 'paused' ? 'Resume' : 'Pause'}>
            {phase === 'paused' ? <Play size={18} /> : <Pause size={18} />}
            {phase === 'paused' ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="ghost" onClick={() => { clockRef.current?.stop(); stopAnim(); scoreRef.current?.update(-1e9); setPhase(result ? 'review' : 'ready'); }}>
            Stop
          </Button>
          <div className="flex-1" />
          <Pill className="tabular">{tempo} BPM</Pill>
        </div>
      )}

      {/* Input surfaces */}
      {(phase === 'playing' || phase === 'paused' || phase === 'preview') && (
        <div className="space-y-2">
          {(mode === 'identify' || mode === 'readahead') && (
            <>
              <div className="h-6 text-center text-sm" aria-live="polite">
                {lastAnswer ? (
                  <span className={lastAnswer.ok ? 'text-good' : 'text-bad'}>{lastAnswer.ok ? '✓' : '✗'} {displayName({ letter: lastAnswer.letter, accidental: 0 }, settings.naming)}</span>
                ) : (
                  <span className="text-faint">{activeEv ? 'Name the current note' : 'Wait for the playhead'}</span>
                )}
              </div>
              <LetterPad onAnswer={(l, a) => identify(l, a)} naming={settings.naming} accidentals={requireAccidental} disabled={!acceptingInput} />
            </>
          )}
          {mode === 'rhythm' && <TapPad onDown={onTapDown} onUp={onTapUp} disabled={!acceptingInput} label="Tap & hold for long notes" />}
          {mode === 'perform' && (
            <>
              <Segmented value={inputDevice} onChange={setInputDevice} options={[{ value: 'fretboard', label: 'Fretboard' }, { value: 'piano', label: 'Keyboard' }]} />
              {inputDevice === 'fretboard' ? <Fretboard onPress={(m) => pressNote(m)} onRelease={releaseNote} /> : <Piano low={guitar ? 40 : clef === 'bass' ? 28 : 48} high={guitar ? 79 : clef === 'bass' ? 64 : 88} onPress={pressNote} onRelease={releaseNote} />}
              {guitar && inputDevice === 'piano' && <p className="text-xs text-faint">The keyboard plays concert pitch — guitar music sounds an octave below the written notes.</p>}
            </>
          )}
          {mode === 'mic' && <MicPanel state={micState} onEnable={enableMic} confidence={settings.mic.confidence} compact />}
        </div>
      )}

      {phase === 'review' && result && (
        <Card className="animate-fade-up space-y-2" >
          <div className="flex items-center gap-3">
            <div className={cx('flex h-14 w-14 items-center justify-center rounded-2xl text-3xl font-black', result.performance >= 0.9 ? 'bg-good/15 text-good' : result.performance >= 0.6 ? 'bg-warn/15 text-warn' : 'bg-bad/15 text-bad')}>{result.grade}</div>
            <div className="flex-1">
              <div className="tabular text-lg font-bold">{pct(result.performance)} <span className="text-sm font-normal text-muted">· timing {pct(result.timing)}</span></div>
              <div className="text-xs text-muted">{result.detail}</div>
            </div>
            <div className="tabular text-right font-bold text-accent">+{result.points}</div>
          </div>
          <div className="flex gap-3 text-[11px] text-muted">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-good" />correct</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-warn" />{mode === 'rhythm' ? 'loose / ' : ''}missed</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-bad" />wrong</span>
          </div>
          {result.lines.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-sm">
              {result.lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}
        </Card>
      )}

      {(phase === 'review' || phase === 'ready') && (
        <div className="space-y-2">
          {phase === 'review' && (
            <div className="grid grid-cols-3 gap-2">
              <Button onClick={replay}><RotateCcw size={18} /> Retry</Button>
              <Button onClick={listen}><Headphones size={18} /> Listen</Button>
              <Button variant="primary" onClick={nextPhrase} autoFocus><SkipForward size={18} /> Next</Button>
            </div>
          )}
          <Card className="space-y-1 py-2">
            {phase === 'review' && <Slider label="Tempo" value={tempo} min={40} max={200} onChange={setTempo} format={(v) => `${v} BPM`} />}
            <Toggle label={<span className="inline-flex items-center gap-2"><Repeat size={16} /> Loop this phrase</span>} checked={loop} onChange={setLoop} />
            <Toggle label="Metronome" checked={settings.metronome} onChange={(v) => updateSettings({ metronome: v })} />
            {guitar && <Toggle label="Show tablature" hint="Hide it to force staff reading" checked={settings.showTab} onChange={(v) => updateSettings({ showTab: v })} />}
          </Card>
          {phase === 'review' && (
            <Button variant="ghost" className="w-full" onClick={finishAll}>
              Finish session
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function MicPanel({ state, onEnable, confidence, compact }: { state: { on: boolean; error?: MicError; level: number; midi: number | null }; onEnable: () => void; confidence: number; compact?: boolean }) {
  const note = state.midi !== null ? noteName(state.midi) : '—';
  return (
    <div className="space-y-2 rounded-2xl border border-line bg-panel-2/60 p-3">
      {!state.on ? (
        <>
          {!compact && (
            <p className="text-sm text-muted">
              Single-note (monophonic) detection only. Chords, strong harmonics and room noise reduce accuracy. Calibrate noise and latency in Settings for best results.
            </p>
          )}
          {state.error && (
            <p className="text-sm text-bad">
              {state.error === 'denied' ? 'Microphone permission was denied. Allow it in your browser settings and try again.' : state.error === 'unsupported' ? 'This browser does not support microphone input.' : 'No microphone available.'}
            </p>
          )}
          <Button onClick={onEnable} className="w-full"><Mic size={18} /> Enable microphone</Button>
        </>
      ) : (
        <div className="flex items-center gap-3">
          <Mic className="text-accent" size={20} />
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-accent transition-[width] duration-75" style={{ width: `${Math.min(100, state.level * 600)}%` }} />
          </div>
          <span className="tabular w-14 text-right font-bold">{note}</span>
        </div>
      )}
      {state.on && !compact && <p className="text-xs text-faint">Confidence threshold {Math.round(confidence * 100)}% · detected pitch shown is concert (sounding) pitch.</p>}
    </div>
  );
}

function noteName(m: number): string {
  const names = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  return `${names[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}
