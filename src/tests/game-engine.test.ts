import { describe, expect, it } from 'vitest';
import { createRng } from '../music-theory/random';
import { ScoreKeeper, SCORING, levelFromXp, scoreAnswer, speedBonus, summarize, xpForLevel } from '../game-engine/scoring';
import {
  NOTE_HUNTER_LEVELS,
  candidatePitches,
  checkNoteAnswer,
  explainNote,
  generateNoteQuestion,
  octaveChoices,
} from '../game-engine/noteHunter';
import { CHORD_LEVELS, CHORD_MODES, checkComponents, generateChordQuestion, displayedPitches } from '../game-engine/chordDecoder';
import { chordKey, chordSymbol, identifyChord, enharmonicallyAmbiguous, CHORD_QUALITIES } from '../music-theory/chords';
import { READING_LEVELS, TUNES, applyPrintedAccidentals, generateExercise, onsetEvents, parseTune } from '../game-engine/sightReading';
import { evaluateIdentify, evaluatePerformance, evaluateRhythm, toleranceFor } from '../game-engine/evaluation';
import { MeasureAccidentalState } from '../music-theory/keys';
import { measureTicks, durationTicks } from '../music-theory/rhythm';
import { diatonicIndex, midi, parsePitch, pitchToString } from '../music-theory/pitch';
import { ledgerLines } from '../notation/staff';
import { GUITAR_WRITTEN_LOW_MIDI, findChordFingering } from '../music-theory/guitar';
import { currentStreak, longestStreak } from '../game-engine/progress';

describe('scoring', () => {
  it('rewards accuracy first', () => {
    expect(scoreAnswer({ correct: false, responseMs: 300, streakBefore: 5, history: [] })).toBe(0);
    expect(scoreAnswer({ correct: true, responseMs: 5000, streakBefore: 0, history: [] })).toBe(SCORING.BASE);
    expect(speedBonus(800)).toBe(50);
    expect(speedBonus(3000)).toBe(0);
    expect(speedBonus(1900)).toBe(25);
  });
  it('applies streak multiplier, capped', () => {
    expect(scoreAnswer({ correct: true, responseMs: 5000, streakBefore: 4, history: [true, true, true, true] })).toBe(120);
    expect(scoreAnswer({ correct: true, responseMs: 5000, streakBefore: 50, history: Array(10).fill(true) })).toBe(150);
  });
  it('withholds the speed bonus while rolling accuracy is low', () => {
    const history = [false, false, false, true, false, true, false, false, true, false];
    expect(scoreAnswer({ correct: true, responseMs: 500, streakBefore: 0, history })).toBe(100);
  });
  it('makes fast random tapping unprofitable', () => {
    const rng = createRng(7);
    const guesser = new ScoreKeeper();
    const careful = new ScoreKeeper();
    for (let i = 0; i < 60; i++) {
      guesser.record(rng.next() < 1 / 7, 250);
      careful.record(rng.next() < 0.92, 2200);
    }
    expect(careful.summary().final).toBeGreaterThan(guesser.summary().final * 10);
  });
  it('summarises sessions', () => {
    const s = summarize([{ correct: true, responseMs: 1000 }, { correct: false, responseMs: 500 }], 200, 1);
    expect(s.accuracy).toBe(0.5);
    expect(s.final).toBe(50);
    expect(s.xp).toBe(5);
    expect(s.medianMs).toBe(1000);
  });
  it('maps XP to levels', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(100).level).toBe(2);
    expect(levelFromXp(299).level).toBe(2);
    expect(levelFromXp(300).level).toBe(3);
  });
});

describe('note hunter', () => {
  it('keeps every level inside its declared range and ledger rules', () => {
    for (const lvl of NOTE_HUNTER_LEVELS) {
      for (const instrument of ['guitar', 'piano'] as const) {
        const cfg = { level: lvl.level, instrument, preferredClef: 'treble' as const, octaveRecognition: false };
        for (const clef of lvl.clefs) {
          const pool = candidatePitches(cfg, clef);
          expect(pool.length).toBeGreaterThan(5);
          if (lvl.level === 1) pool.forEach((p) => expect(ledgerLines(p, clef).count).toBe(0));
          if (lvl.level === 6) expect(pool.some((p) => p.accidental !== 0)).toBe(true);
        }
      }
    }
    const l3 = candidatePitches({ level: 3, instrument: 'guitar', preferredClef: 'treble', octaveRecognition: false }, 'treble');
    expect(l3.map(pitchToString)).toContain('E3');
    expect(Math.max(...l3.map((p) => ledgerLines(p, 'treble').count))).toBe(3);
  });
  it('grades answers including accidentals and octaves', () => {
    const rng = createRng(3);
    for (let i = 0; i < 50; i++) {
      const q = generateNoteQuestion({ level: 6, instrument: 'piano', preferredClef: 'treble', octaveRecognition: false }, rng);
      const opts = { octaveRecognition: true, instrument: 'piano' as const, octaveLabels: 'written' as const };
      expect(checkNoteAnswer(q, { letter: q.target.letter, accidental: q.target.accidental, octave: q.target.octave }, opts)).toBe(true);
      expect(checkNoteAnswer(q, { letter: q.target.letter, accidental: q.target.accidental, octave: q.target.octave + 1 }, opts)).toBe(false);
      if (q.target.accidental !== 0) expect(checkNoteAnswer(q, { letter: q.target.letter, accidental: 0, octave: q.target.octave }, opts)).toBe(false);
    }
  });
  it('uses sounding octaves for guitar when requested', () => {
    const q = generateNoteQuestion({ level: 1, instrument: 'guitar', preferredClef: 'treble', octaveRecognition: true }, createRng(1));
    const opts = { octaveRecognition: true, instrument: 'guitar' as const, octaveLabels: 'sounding' as const };
    expect(checkNoteAnswer(q, { letter: q.target.letter, octave: q.target.octave - 1 }, opts)).toBe(true);
    expect(checkNoteAnswer(q, { letter: q.target.letter, octave: q.target.octave }, opts)).toBe(false);
    const choices = octaveChoices({ level: 1, instrument: 'guitar', preferredClef: 'treble', octaveRecognition: true }, 'treble', 'sounding');
    expect(choices).toContain(q.target.octave - 1);
  });
  it('resolves key signatures and accidental carry-over consistently', () => {
    const rng = createRng(11);
    for (let i = 0; i < 200; i++) {
      const q = generateNoteQuestion({ level: 7, instrument: 'piano', preferredClef: 'treble', octaveRecognition: false }, rng);
      expect(q.keyFifths).not.toBe(0);
      const st = new MeasureAccidentalState(q.keyFifths);
      for (const c of q.context) {
        const reading = st.applyPrinted(c.pitch.letter, c.pitch.octave, c.printed);
        expect(reading).toBe(c.pitch.accidental);
      }
      expect(st.applyPrinted(q.target.letter, q.target.octave, q.printed)).toBe(q.target.accidental);
      expect(explainNote(q).length).toBeGreaterThan(10);
    }
  });
  it('alternates clefs at the mixed level', () => {
    const rng = createRng(5);
    const clefs = new Set<string>();
    let prev;
    for (let i = 0; i < 30; i++) {
      prev = generateNoteQuestion({ level: 9, instrument: 'piano', preferredClef: 'both', octaveRecognition: false }, rng, {}, Date.now(), { previous: prev });
      clefs.add(prev.clef);
    }
    expect(clefs).toEqual(new Set(['treble', 'bass']));
  });
  it('focuses on weak notes', () => {
    const rng = createRng(9);
    const stats = {
      'note:treble:F5': { key: 'note:treble:F5', category: 'note' as const, attempts: 10, correct: 2, recent: [false, false, true], times: [3000], lastPracticed: 0, streak: 0, box: 0, dueAt: 0 },
      'note:treble:E4': { key: 'note:treble:E4', category: 'note' as const, attempts: 10, correct: 10, recent: Array(10).fill(true), times: [500], lastPracticed: 0, streak: 10, box: 5, dueAt: Date.now() + 1e9 },
    };
    let f5 = 0;
    for (let i = 0; i < 50; i++) {
      const q = generateNoteQuestion({ level: 1, instrument: 'piano', preferredClef: 'treble', octaveRecognition: false }, rng, stats, Date.now(), { weakOnly: true });
      if (pitchToString(q.target) === 'F5') f5++;
    }
    expect(f5).toBeGreaterThan(20);
  });
});

describe('chord decoder', () => {
  const modes = CHORD_MODES.map((m) => m.id).filter((m) => m !== 'progression');
  it('generates notation that matches the answer, with exactly one correct option', () => {
    for (const instrument of ['guitar', 'piano'] as const) {
      for (const lvl of CHORD_LEVELS) {
        const rng = createRng(lvl.level * 101 + (instrument === 'guitar' ? 1 : 0));
        for (const mode of modes) {
          if (mode === 'fretboard' && instrument === 'piano') continue;
          for (let i = 0; i < 6; i++) {
            const q = generateChordQuestion({ level: lvl.level, mode, instrument, naming: 'english' }, rng);
            const shown = displayedPitches(q.voicing);
            // Notation ↔ answer consistency
            if (mode !== 'missing' && !q.voicing.rootless) {
              const readings = identifyChord(shown, [q.answer.quality]);
              expect(readings.map(chordKey), `${chordSymbol(q.answer)} from ${shown.map(pitchToString)}`).toContain(chordKey(q.answer));
              expect(diatonicIndex(shown[0])).toBeLessThanOrEqual(Math.min(...shown.map(diatonicIndex)));
            }
            if (q.voicing.rootless) expect(q.context).toBeTruthy();
            if (mode !== 'components') {
              expect(q.options.length).toBe(4);
              expect(q.correctIndex).toBeGreaterThanOrEqual(0);
              expect(new Set(q.options.map((o) => o.label)).size).toBe(4);
            }
            // Distractors are never alternative valid readings
            q.options.forEach((o, idx) => {
              if (idx !== q.correctIndex && o.spec) expect(enharmonicallyAmbiguous(o.spec, q.answer)).toBe(false);
            });
            if (instrument === 'guitar' && mode !== 'missing') expect(q.voicing.fingering).not.toBeNull();
            if (instrument === 'guitar') {
              const sounding = q.voicing.notes.map((n) => midi(n.pitch) - 12);
              expect(sounding).toEqual(q.voicing.sounding);
            }
          }
        }
      }
    }
  });
  it('grades components separately', () => {
    const q = generateChordQuestion({ level: 6, mode: 'components', instrument: 'piano', naming: 'english' }, createRng(4));
    const ok = checkComponents(q, q.answer.root, q.answer.quality, q.components!.answerInversion);
    expect(ok.all).toBe(true);
    const wrongInv = checkComponents(q, q.answer.root, q.answer.quality, (q.components!.answerInversion + 1) % q.components!.inversions.length);
    expect(wrongInv.inversion).toBe(false);
    expect(wrongInv.root).toBe(true);
  });
  it('builds progressions with correct labels', () => {
    const rng = createRng(77);
    for (let i = 0; i < 30; i++) {
      const q = generateChordQuestion({ level: 6, mode: 'progression', instrument: i % 2 ? 'guitar' : 'piano', naming: 'english' }, rng);
      expect(q.progression!.chords.length).toBe(q.progression!.labels.length);
      expect(q.options[q.correctIndex].label.split(' – ')).toEqual(q.progression!.labels);
    }
  });
  it('produces playable guitar voicings', () => {
    const rng = createRng(12);
    for (let i = 0; i < 40; i++) {
      const q = generateChordQuestion({ level: (i % 10) + 1, mode: 'name', instrument: 'guitar', naming: 'english' }, rng);
      expect(findChordFingering(q.voicing.sounding)).not.toBeNull();
      expect(Math.min(...q.voicing.sounding)).toBeGreaterThanOrEqual(40);
    }
  });
  it('has formulas for every quality', () => {
    Object.values(CHORD_QUALITIES).forEach((d) => expect(d.formula[0]).toBe('1'));
  });
});

describe('sight-reading generator', () => {
  it('fills every measure exactly and keeps notation consistent', () => {
    for (const lvl of READING_LEVELS) {
      for (const instrument of ['guitar', 'piano'] as const) {
        for (const clef of ['treble', 'bass'] as const) {
          if (instrument === 'guitar' && clef === 'bass') continue;
          for (let seed = 0; seed < 12; seed++) {
            const ex = generateExercise({ level: lvl.level, instrument, clef }, createRng(seed * 31 + lvl.level));
            const mt = measureTicks(ex.timeSig);
            ex.measures.forEach((m) => expect(m.reduce((s, e) => s + e.ticks, 0)).toBe(mt));
            expect(ex.totalTicks).toBe(mt * ex.measures.length);
            ex.events.forEach((e) => expect(e.ticks).toBe(durationTicks(e.duration)));
            // Reading the printed accidentals back yields the intended pitches.
            ex.measures.forEach((m) => {
              const st = new MeasureAccidentalState(ex.keyFifths);
              m.forEach((e, idx) => {
                if (e.tiedFromPrev && idx === 0) return;
                e.pitches.forEach((p, j) => expect(st.applyPrinted(p.letter, p.octave, e.printed[j])).toBe(p.accidental));
              });
            });
            // Guitar range
            if (instrument === 'guitar') ex.events.forEach((e) => e.pitches.forEach((p) => expect(midi(p)).toBeGreaterThanOrEqual(GUITAR_WRITTEN_LOW_MIDI)));
            // Ties connect equal pitches
            ex.events.forEach((e, i) => {
              if (e.tieToNext) expect(pitchToString(ex.events[i + 1].pitches[0])).toBe(pitchToString(e.pitches[0]));
            });
            expect(onsetEvents(ex).length).toBeGreaterThan(0);
          }
        }
      }
    }
  });
  it('ends generated phrases on the tonic', () => {
    for (let seed = 0; seed < 20; seed++) {
      const ex = generateExercise({ level: 2, instrument: 'piano', clef: 'treble' }, createRng(seed));
      if (ex.source) continue;
      const last = onsetEvents(ex).at(-1)!;
      expect(last.pitches.at(-1)!.letter).toBe(ex.mode === 'major' ? (['C'] as string[])[0] : 'A');
    }
  });
  it('level 1 is stepwise quarter notes', () => {
    const ex = generateExercise({ level: 1, instrument: 'guitar', clef: 'treble' }, createRng(2));
    const notes = onsetEvents(ex);
    for (let i = 1; i < notes.length - 1; i++) {
      expect(Math.abs(diatonicIndex(notes[i].pitches[0]) - diatonicIndex(notes[i - 1].pitches[0]))).toBeLessThanOrEqual(1);
    }
    ex.events.slice(0, -1).forEach((e) => expect(['q', 'h']).toContain(e.duration.base));
  });
  it('encodes public-domain tunes with complete bars', () => {
    for (const t of TUNES) {
      const bars = parseTune(t.melody);
      bars.forEach((b) => expect(b.reduce((s, n) => s + durationTicks(n.duration), 0)).toBe(measureTicks(t.ts)));
    }
  });
  it('omits accidentals already implied by the bar', () => {
    const m = [[{ id: 0, measure: 0, start: 0, ticks: 48, duration: { base: 'q' as const, dots: 0 as const }, rest: false, pitches: [parsePitch('F#4')], printed: [] as (0 | 1 | -1 | null)[] },
      { id: 1, measure: 0, start: 48, ticks: 48, duration: { base: 'q' as const, dots: 0 as const }, rest: false, pitches: [parsePitch('F#4')], printed: [] as (0 | 1 | -1 | null)[] }]];
    applyPrintedAccidentals(m, 0);
    expect(m[0][0].printed).toEqual([1]);
    expect(m[0][1].printed).toEqual([null]);
  });
});

describe('evaluation', () => {
  const ex = generateExercise({ level: 2, instrument: 'piano', clef: 'treble' }, createRng(21));
  const tol = toleranceFor(60, ex);
  const onsets = onsetEvents(ex);
  it('scores perfect rhythm taps', () => {
    const r = evaluateRhythm(ex, onsets.map((e) => ({ tick: e.start + 1 })), tol);
    expect(r.hits).toBe(onsets.length);
    expect(r.accuracy).toBe(1);
    expect(r.extraTaps).toBe(0);
    expect(r.timing).toBeGreaterThan(0.8);
  });
  it('counts misses and extra taps', () => {
    const taps = onsets.slice(1).map((e) => ({ tick: e.start })).concat([{ tick: ex.totalTicks + 500 }]);
    const r = evaluateRhythm(ex, taps, tol);
    expect(r.notes[0].status).toBe('missed');
    expect(r.extraTaps).toBe(1);
    expect(r.accuracy).toBeLessThan(1);
  });
  it('rejects taps outside tolerance', () => {
    const r = evaluateRhythm(ex, onsets.map((e) => ({ tick: e.start + tol.hitTicks + 1 })), tol);
    expect(r.hits).toBe(0);
  });
  it('evaluates melody performance with pitch, octave and timing', () => {
    const played = onsets.map((e, i) => ({ tick: e.start, midi: midi(e.pitches.at(-1)!) + (i === 0 ? 12 : i === 1 ? 1 : 0) }));
    const r = evaluatePerformance(ex, played, tol, 0);
    expect(r.notes[0].status).toBe('wrong-octave');
    expect(r.notes[1].status).toBe('wrong-pitch');
    expect(r.correct).toBe(onsets.length - 2);
    expect(r.continuity).toBeCloseTo((onsets.length - 2) / onsets.length);
  });
  it('accounts for guitar transposition', () => {
    const played = onsets.map((e) => ({ tick: e.start, midi: midi(e.pitches.at(-1)!) - 12 }));
    expect(evaluatePerformance(ex, played, tol, -12).correct).toBe(onsets.length);
    expect(evaluatePerformance(ex, played, tol, 0).correct).toBe(0);
  });
  it('evaluates read-and-identify answers', () => {
    const answers = onsets.map((e) => ({ tick: e.start + 5, letter: e.pitches.at(-1)!.letter, accidental: e.pitches.at(-1)!.accidental }));
    expect(evaluateIdentify(ex, answers, true).accuracy).toBe(1);
    expect(evaluateIdentify(ex, answers.slice(2), true).notes[0].status).toBe('missed');
  });
});

describe('streaks', () => {
  it('counts consecutive days', () => {
    expect(currentStreak(['2026-10-30', '2026-10-31', '2026-11-01'], '2026-11-01')).toBe(3);
    expect(currentStreak(['2026-10-30', '2026-10-31'], '2026-11-01')).toBe(2);
    expect(currentStreak(['2026-10-29'], '2026-11-01')).toBe(0);
    expect(longestStreak(['2026-01-01', '2026-01-02', '2026-01-05'])).toBe(2);
  });
});
