import { describe, expect, it } from 'vitest';
import { diatonicIndex, displayName, fromMidi, midi, parsePitch, pitchToString, frequency } from '../music-theory/pitch';
import { DEGREES, intervalBetween, intervalLongName, intervalName, transpose } from '../music-theory/interval';
import { MeasureAccidentalState, keyAccidentals, keyFromFifths, scale, vexKeySpec } from '../music-theory/keys';
import {
  chordSymbol,
  chordTones,
  enharmonicallyAmbiguous,
  identifyChord,
  inversionOf,
  bassTone,
} from '../music-theory/chords';
import {
  findChordFingering,
  midiAt,
  positionsForMidi,
  soundingToWritten,
  writtenToSounding,
  melodyPositions,
} from '../music-theory/guitar';
import { beatTicks, beatsPerMeasure, durationTicks, isCompound, measureTicks, secondsPerTick, ticksToDuration } from '../music-theory/rhythm';
import { createRng } from '../music-theory/random';
import { describeStaffPosition, ledgerLines, staffStep, vexKey } from '../notation/staff';

const P = parsePitch;
const names = (ps: { pitch: ReturnType<typeof P> }[]) => ps.map((t) => pitchToString(t.pitch));

describe('pitch', () => {
  it('computes MIDI numbers with C4 = 60', () => {
    expect(midi(P('C4'))).toBe(60);
    expect(midi(P('A4'))).toBe(69);
    expect(midi(P('E2'))).toBe(40);
    expect(midi(P('B#3'))).toBe(60);
    expect(midi(P('Cb4'))).toBe(59);
    expect(midi(P('F##4'))).toBe(67);
  });
  it('keeps octave with the letter (B#3 ≠ C4 on the staff)', () => {
    expect(diatonicIndex(P('B#3'))).toBe(diatonicIndex(P('B3')));
    expect(diatonicIndex(P('C4')) - diatonicIndex(P('B3'))).toBe(1);
  });
  it('round-trips strings and MIDI', () => {
    expect(pitchToString(P('Eb5'))).toBe('Eb5');
    expect(pitchToString(fromMidi(61, 'flat'))).toBe('Db4');
    expect(pitchToString(fromMidi(61, 'sharp'))).toBe('C#4');
    expect(frequency(P('A4'))).toBeCloseTo(440);
  });
  it('supports solfège naming', () => {
    expect(displayName(P('F#4'), 'solfege')).toBe('Fa♯');
    expect(displayName(P('Bb3'), 'english', true)).toBe('B♭3');
  });
});

describe('intervals & spelling', () => {
  it('spells by letter steps', () => {
    expect(pitchToString(transpose(P('C4'), DEGREES['3']))).toBe('E4');
    expect(pitchToString(transpose(P('C4'), DEGREES['#9']))).toBe('D#5');
    expect(pitchToString(transpose(P('C4'), DEGREES.b3))).toBe('Eb4');
    expect(pitchToString(transpose(P('E4'), DEGREES['3']))).toBe('G#4');
    expect(pitchToString(transpose(P('C4'), DEGREES.bb7))).toBe('Bbb4');
    expect(pitchToString(transpose(P('B3'), DEGREES.b2))).toBe('C4');
  });
  it('names intervals including compounds', () => {
    expect(intervalName(intervalBetween(P('C4'), P('E4')))).toBe('M3');
    expect(intervalName(intervalBetween(P('C4'), P('Eb4')))).toBe('m3');
    expect(intervalName(intervalBetween(P('C4'), P('F#4')))).toBe('A4');
    expect(intervalName(intervalBetween(P('C4'), P('Gb4')))).toBe('d5');
    expect(intervalName(intervalBetween(P('C4'), P('D5')))).toBe('M9');
    expect(intervalName(intervalBetween(P('C4'), P('C5')))).toBe('P8');
    expect(intervalName(intervalBetween(P('E4'), P('C5')))).toBe('m6');
    expect(intervalLongName(intervalBetween(P('G3'), P('F4')))).toBe('minor 7th');
  });
});

describe('keys and measure accidentals', () => {
  it('builds key signatures', () => {
    expect(keyAccidentals(2)).toMatchObject({ F: 1, C: 1, G: 0 });
    expect(keyAccidentals(-3)).toMatchObject({ B: -1, E: -1, A: -1, D: 0 });
    expect(vexKeySpec(keyFromFifths(-2))).toBe('Bb');
    expect(vexKeySpec(keyFromFifths(3, 'minor'))).toBe('F#m');
  });
  it('spells scales correctly', () => {
    expect(scale({ letter: 'F', accidental: 1 }, 'major').map(pitchToString)).toEqual(['F#4', 'G#4', 'A#4', 'B4', 'C#5', 'D#5', 'E#5']);
    expect(scale({ letter: 'A', accidental: 0 }, 'harmonic-minor').map(pitchToString)).toEqual(['A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G#5']);
  });
  it('carries accidentals through the measure, per octave', () => {
    const st = new MeasureAccidentalState(2); // D major: F#, C#
    expect(st.displayFor(P('F#4'))).toBeNull(); // in key
    expect(st.displayFor(P('C4'))).toBe(0); // natural sign needed
    expect(st.displayFor(P('C4'))).toBeNull(); // carried
    expect(st.displayFor(P('C5'))).toBe(0); // other octave needs its own sign
    expect(st.displayFor(P('C#4'))).toBe(1); // restore sharp
  });
  it('reads implied accidentals', () => {
    const st = new MeasureAccidentalState(-1);
    expect(st.implied('B', 4)).toBe(-1);
    expect(st.applyPrinted('B', 4, 0)).toBe(0);
    expect(st.implied('B', 4)).toBe(0);
    expect(st.implied('B', 3)).toBe(-1);
  });
});

describe('chords', () => {
  it('builds chords from formulas', () => {
    expect(names(chordTones({ letter: 'C', accidental: 0 }, 'maj7'))).toEqual(['C4', 'E4', 'G4', 'B4']);
    expect(names(chordTones({ letter: 'F', accidental: 1 }, 'm7b5'))).toEqual(['F#4', 'A4', 'C5', 'E5']);
    expect(names(chordTones({ letter: 'B', accidental: 0 }, 'dim7'))).toEqual(['B4', 'D5', 'F5', 'Ab5']);
    expect(names(chordTones({ letter: 'E', accidental: -1 }, 'aug'))).toEqual(['Eb4', 'G4', 'B4']);
    expect(names(chordTones({ letter: 'G', accidental: 0 }, '7#9'))).toEqual(['G4', 'B4', 'D5', 'F5', 'A#5']);
  });
  it('writes chord symbols and slash chords', () => {
    expect(chordSymbol({ root: { letter: 'B', accidental: -1 }, quality: 'maj', bass: '3' })).toBe('B♭/D');
    expect(chordSymbol({ root: { letter: 'F', accidental: 1 }, quality: 'm7b5', bass: '1' })).toBe('F♯m7♭5');
    expect(chordSymbol({ root: { letter: 'G', accidental: 0 }, quality: '7', bass: 'b7' })).toBe('G7/F');
    expect(pitchToString(bassTone({ root: { letter: 'A', accidental: 0 }, quality: 'min', bass: '5' }))).toBe('E5');
  });
  it('classifies inversions independently of quality', () => {
    expect(inversionOf('maj', '3')).toBe(1);
    expect(inversionOf('min', 'b3')).toBe(1);
    expect(inversionOf('dim', 'b5')).toBe(2);
    expect(inversionOf('7', 'b7')).toBe(3);
    expect(inversionOf('maj7', '1')).toBe(0);
  });
  it('identifies chords without assuming the lowest note is the root', () => {
    const firstInv = identifyChord([P('E4'), P('G4'), P('C5')], ['maj', 'min']);
    expect(firstInv).toEqual([{ root: { letter: 'C', accidental: 0 }, quality: 'maj', bass: '3' }]);
    const g7third = identifyChord([P('F3'), P('G3'), P('B3'), P('D4')], ['7', 'maj7', 'm7']);
    expect(g7third[0]).toMatchObject({ root: { letter: 'G' }, quality: '7', bass: 'b7' });
  });
  it('reports genuinely ambiguous spellings', () => {
    const readings = identifyChord([P('C4'), P('E4'), P('G4'), P('A4')], ['6', 'm7']);
    expect(readings).toHaveLength(2);
    expect(enharmonicallyAmbiguous(
      { root: { letter: 'C', accidental: 0 }, quality: '6', bass: '1' },
      { root: { letter: 'A', accidental: 0 }, quality: 'm7', bass: 'b3' },
    )).toBe(true);
    expect(enharmonicallyAmbiguous(
      { root: { letter: 'C', accidental: 0 }, quality: 'maj', bass: '1' },
      { root: { letter: 'C', accidental: 0 }, quality: 'maj', bass: '3' },
    )).toBe(false);
  });
});

describe('guitar', () => {
  it('never confuses written and sounding octaves', () => {
    expect(pitchToString(writtenToSounding(P('E5')))).toBe('E4');
    expect(pitchToString(soundingToWritten(P('E2')))).toBe('E3');
    expect(midi(P('E4'))).toBe(64); // open high e, sounding
  });
  it('finds every fret position for a pitch', () => {
    const pos = positionsForMidi(64); // E4 sounding
    expect(pos).toEqual(
      expect.arrayContaining([
        { string: 5, fret: 0 },
        { string: 4, fret: 5 },
        { string: 3, fret: 9 },
        { string: 2, fret: 14 },
      ]),
    );
    expect(pos).toHaveLength(4);
  });
  it('finds playable chord fingerings', () => {
    // Open C major: C3 E3 G3 C4 E4
    const f = findChordFingering([48, 52, 55, 60, 64]);
    expect(f).not.toBeNull();
    expect(f!.positions.map(midiAt)).toEqual([48, 52, 55, 60, 64]);
    expect(f!.span).toBeLessThanOrEqual(3);
    // Unplayable cluster
    expect(findChordFingering([40, 41, 42, 43, 44, 45, 46])).toBeNull();
  });
  it('keeps melodies in a hand position', () => {
    const pos = melodyPositions([60, 62, 64, 65, 67]);
    pos.forEach((p) => expect(p).not.toBeNull());
    const frets = pos.map((p) => p!.fret);
    expect(Math.max(...frets)).toBeLessThanOrEqual(5);
  });
});

describe('rhythm', () => {
  it('computes ticks and meters', () => {
    expect(durationTicks({ base: 'q', dots: 1 })).toBe(72);
    expect(measureTicks({ beats: 6, beatValue: 8 })).toBe(144);
    expect(isCompound({ beats: 6, beatValue: 8 })).toBe(true);
    expect(isCompound({ beats: 3, beatValue: 8 })).toBe(false);
    expect(beatTicks({ beats: 12, beatValue: 8 })).toBe(72);
    expect(beatsPerMeasure({ beats: 12, beatValue: 8 })).toBe(4);
    expect(beatsPerMeasure({ beats: 3, beatValue: 4 })).toBe(3);
    expect(ticksToDuration(36)).toEqual({ base: '8', dots: 1 });
    expect(secondsPerTick(60, { beats: 4, beatValue: 4 }) * 48).toBeCloseTo(1);
    expect(secondsPerTick(60, { beats: 6, beatValue: 8 }) * 72).toBeCloseTo(1);
  });
});

describe('staff positions', () => {
  it('maps notes to lines, spaces and ledger lines', () => {
    expect(staffStep(P('B4'), 'treble')).toBe(0);
    expect(staffStep(P('D3'), 'bass')).toBe(0);
    expect(describeStaffPosition(P('E4'), 'treble')).toBe('1st line');
    expect(describeStaffPosition(P('F5'), 'treble')).toBe('5th line');
    expect(describeStaffPosition(P('A4'), 'treble')).toBe('2nd space');
    expect(ledgerLines(P('C4'), 'treble')).toEqual({ count: 1, direction: 'below' });
    expect(ledgerLines(P('A5'), 'treble')).toEqual({ count: 1, direction: 'above' });
    expect(ledgerLines(P('C6'), 'treble')).toEqual({ count: 2, direction: 'above' });
    expect(ledgerLines(P('B5'), 'treble')).toEqual({ count: 1, direction: 'above' });
    expect(ledgerLines(P('E3'), 'treble')).toEqual({ count: 3, direction: 'below' });
    expect(ledgerLines(P('C4'), 'bass')).toEqual({ count: 1, direction: 'above' });
    expect(ledgerLines(P('E2'), 'bass')).toEqual({ count: 1, direction: 'below' });
    expect(describeStaffPosition(P('C4'), 'treble')).toBe('1st ledger line below the staff');
    expect(describeStaffPosition(P('B5'), 'treble')).toBe('above the 1st ledger line above the staff');
  });
  it('builds VexFlow keys', () => {
    expect(vexKey(P('C#4'))).toBe('c#/4');
    expect(vexKey(P('Bb3'))).toBe('bb/3');
  });
});

describe('seeded rng', () => {
  it('is reproducible', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a.next(), a.next(), a.int(1, 6)]).toEqual([b.next(), b.next(), b.int(1, 6)]);
  });
});
