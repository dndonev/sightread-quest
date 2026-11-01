import {
  Accidental as VFAccidental,
  Beam,
  Dot,
  Formatter,
  Fraction,
  GhostNote,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  TabNote,
  TabStave,
  Voice,
  type RenderContext,
} from 'vexflow/bravura';
import type { Accidental, Pitch } from '../music-theory/pitch';
import { accidentalAscii, midi } from '../music-theory/pitch';
import { keyFromFifths, vexKeySpec } from '../music-theory/keys';
import { type Clef, clefForPitch, vexKey } from './staff';
import type { Exercise, ScoreEvent } from '../game-engine/sightReading';
import { vexDuration, isCompound, beatTicks, PPQ } from '../music-theory/rhythm';
import { melodyPositions, stringNumber } from '../music-theory/guitar';

export const INK = '#e8eef7';
export const DIM = '#7c8aa5';
export const ACCENT = '#2dd4bf';
export const BLUE = '#38bdf8';
export const GOOD = '#4ade80';
export const BAD = '#f87171';
export const WARN = '#fbbf24';
export const PANEL = '#0f1829';

const style = (c: string) => ({ fillStyle: c, strokeStyle: c });

function setup(el: HTMLElement, width: number, height: number, scale = 1): RenderContext {
  el.innerHTML = '';
  const renderer = new Renderer(el as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(width, height);
  const ctx = renderer.getContext();
  ctx.setFillStyle(INK);
  ctx.setStrokeStyle(INK);
  ctx.setBackgroundFillStyle(PANEL); // tab fret numbers clear the staff line behind them
  if (scale !== 1) ctx.scale(scale, scale);
  const svg = el.querySelector('svg');
  if (svg) {
    svg.setAttribute('role', 'img');
    svg.style.maxWidth = '100%';
    svg.style.overflow = 'visible';
  }
  return ctx;
}

function vfAcc(a: Accidental): string {
  return a === 0 ? 'n' : accidentalAscii(a);
}

function styledStave(s: Stave) {
  s.setStyle(style(INK));
  return s;
}

function clefAnnotation(clef: Clef, guitar8vb: boolean): string | undefined {
  return clef === 'treble' && guitar8vb ? '8vb' : undefined;
}

/* ---------------- Simple: a few notes / a chord on one staff ---------------- */

export interface SimpleNote {
  pitches: Pitch[];
  printed: (Accidental | null)[];
  duration?: string;
  color?: string;
  /** Per-pitch colours (chords). */
  keyColors?: (string | undefined)[];
}

export interface SimpleOptions {
  clef: Clef;
  keyFifths?: number;
  guitar8vb?: boolean;
  width: number;
  height?: number;
  /** Render on a grand staff, splitting at middle C. */
  grand?: boolean;
  scale?: number;
  label?: string;
}

function makeNote(n: SimpleNote, clef: Clef): StaveNote {
  const dur = n.duration ?? 'w';
  const sorted = n.pitches.map((p, i) => ({ p, printed: n.printed[i], color: n.keyColors?.[i] })).sort((a, b) => midi(a.p) - midi(b.p));
  const note = new StaveNote({ keys: sorted.map((x) => vexKey(x.p)), duration: dur, clef, autoStem: true });
  sorted.forEach((x, i) => {
    if (x.printed !== null && x.printed !== undefined) note.addModifier(new VFAccidental(vfAcc(x.printed)), i);
  });
  note.setStyle(style(n.color ?? INK));
  note.setLedgerLineStyle(style(INK));
  sorted.forEach((x, i) => x.color && note.setKeyStyle(i, style(x.color)));
  return note;
}

export function renderSimple(el: HTMLElement, notes: SimpleNote[], opts: SimpleOptions) {
  const scale = opts.scale ?? 1;
  const keySpec = vexKeySpec(keyFromFifths(opts.keyFifths ?? 0));
  if (opts.grand) {
    const height = opts.height ?? 250;
    const ctx = setup(el, opts.width, height * scale, scale);
    const w = opts.width / scale - 20;
    const treble = styledStave(new Stave(10, 10, w)).addClef('treble').addKeySignature(keySpec);
    const bass = styledStave(new Stave(10, 120, w)).addClef('bass').addKeySignature(keySpec);
    treble.setContext(ctx).draw();
    bass.setContext(ctx).draw();
    const brace = new StaveConnector(treble, bass).setType('brace');
    brace.setContext(ctx).draw();
    new StaveConnector(treble, bass).setType('singleLeft').setContext(ctx).draw();
    new StaveConnector(treble, bass).setType('singleRight').setContext(ctx).draw();
    const split = (n: SimpleNote, clef: Clef): SimpleNote | null => {
      const idx = n.pitches.map((p, i) => ({ p, i })).filter(({ p }) => clefForPitch(p) === clef);
      if (!idx.length) return null;
      return { ...n, pitches: idx.map((x) => x.p), printed: idx.map((x) => n.printed[x.i]), keyColors: n.keyColors && idx.map((x) => n.keyColors![x.i]) };
    };
    for (const [stave, clef] of [[treble, 'treble'], [bass, 'bass']] as const) {
      const tickables = notes.map((n) => {
        const part = split(n, clef);
        return part ? makeNote(part, clef) : new GhostNote({ duration: n.duration ?? 'w' });
      });
      const all = notes.length === 1 ? [new GhostNote({ duration: notes[0].duration ?? 'w' }), ...tickables] : tickables;
      const voice = new Voice({ numBeats: 4, beatValue: 4 }).setMode(Voice.Mode.SOFT).addTickables(all);
      new Formatter().joinVoices([voice]).format([voice], (stave.getNoteEndX() - stave.getNoteStartX()) * 0.62);
      voice.draw(ctx, stave);
    }
    return;
  }
  const height = opts.height ?? 150;
  const ctx = setup(el, opts.width, height * scale, scale);
  const w = opts.width / scale - 20;
  const stave = styledStave(new Stave(10, Math.max(0, (height - 120) / 2 + 5), w)).addClef(opts.clef, 'default', clefAnnotation(opts.clef, !!opts.guitar8vb));
  if (opts.keyFifths) stave.addKeySignature(keySpec);
  stave.setContext(ctx).draw();
  const tickables = notes.map((n) => makeNote(n, opts.clef));
  const avail = stave.getNoteEndX() - stave.getNoteStartX() - 10;
  // A leading ghost note centres a single note/chord (keeps accidentals attached to it).
  const all = notes.length === 1 ? [new GhostNote({ duration: tickables[0].getDuration() }), ...tickables] : tickables;
  const voice = new Voice({ numBeats: 4, beatValue: 4 }).setMode(Voice.Mode.SOFT).addTickables(all);
  new Formatter().joinVoices([voice]).format([voice], Math.max(40, notes.length === 1 ? avail * 0.62 : avail * 0.9));
  voice.draw(ctx, stave);
}

/* ---------------- Progressions ---------------- */

export function renderChordSequence(el: HTMLElement, chords: Pitch[][], opts: { clef: Clef; keyFifths: number; guitar8vb?: boolean; width: number; grand?: boolean }) {
  const keySpec = vexKeySpec(keyFromFifths(opts.keyFifths));
  const perLine = opts.width < 480 ? 2 : 4;
  const lines = Math.ceil(chords.length / perLine);
  const lineH = 140;
  const ctx = setup(el, opts.width, lines * lineH + 10);
  const usable = opts.width - 20;
  for (let l = 0; l < lines; l++) {
    const slice = chords.slice(l * perLine, (l + 1) * perLine);
    const extra = 50 + Math.abs(opts.keyFifths) * 11;
    const mw = (usable - extra) / perLine;
    let x = 10;
    slice.forEach((pitches, i) => {
      const w = i === 0 ? mw + extra : mw;
      const st = styledStave(new Stave(x, l * lineH + 10, w));
      if (i === 0) st.addClef(opts.clef, 'default', clefAnnotation(opts.clef, !!opts.guitar8vb)).addKeySignature(keySpec);
      st.setContext(ctx).draw();
      // Accidentals relative to the key signature (each chord in its own bar).
      const keyMap = keyMapFor(opts.keyFifths);
      const note = makeNote({ pitches, printed: pitches.map((p) => (keyMap[p.letter] === p.accidental ? null : p.accidental)) }, opts.clef);
      const voice = new Voice({ numBeats: 4, beatValue: 4 }).setMode(Voice.Mode.SOFT).addTickables([new GhostNote({ duration: 'w' }), note]);
      new Formatter().joinVoices([voice]).format([voice], Math.max(30, (st.getNoteEndX() - st.getNoteStartX()) * 0.62));
      voice.draw(ctx, st);
      x += w;
    });
  }
}

function keyMapFor(fifths: number): Record<string, Accidental> {
  const sharps = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const flats = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  const map: Record<string, Accidental> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (fifths > 0) sharps.slice(0, fifths).forEach((l) => (map[l] = 1));
  if (fifths < 0) flats.slice(0, -fifths).forEach((l) => (map[l] = -1));
  return map;
}

/* ---------------- Full score with layout info ---------------- */

export interface ScoreLayout {
  width: number;
  height: number;
  lines: { top: number; height: number; staffTop: number; staffBottom: number }[];
  measures: { line: number; x0: number; x1: number; noteStart: number }[];
  events: Map<number, { x: number; line: number }>;
}

export interface ScoreOptions {
  width: number;
  guitar8vb: boolean;
  showTab: boolean;
  colors?: Map<number, string>;
}

export function renderScore(el: HTMLElement, ex: Exercise, opts: ScoreOptions): ScoreLayout {
  const perLine = opts.width < 420 ? 2 : opts.width < 760 ? 3 : 4;
  const nLines = Math.ceil(ex.measures.length / perLine);
  const staffH = 120;
  const tabH = opts.showTab ? 95 : 0;
  const lineH = staffH + tabH + 18;
  const height = nLines * lineH + 10;
  const ctx = setup(el, opts.width, height);
  const keySpec = vexKeySpec(keyFromFifths(ex.keyFifths, ex.mode));
  const layout: ScoreLayout = { width: opts.width, height, lines: [], measures: [], events: new Map() };
  const usable = opts.width - 16;
  const compound = isCompound(ex.timeSig);
  const beamGroup = compound ? new Fraction(3, 8) : ex.timeSig.beatValue === 8 ? new Fraction(1, 8) : new Fraction(beatTicks(ex.timeSig) / PPQ, 4);

  // Tab positions for melody notes (sounding = written − 12)
  const tabPositions = opts.showTab ? melodyPositions(ex.events.filter((e) => !e.rest).map((e) => midi(e.pitches[e.pitches.length - 1]) - 12)) : [];
  let tabIdx = 0;

  const vfNotes = new Map<number, StaveNote>();
  for (let l = 0; l < nLines; l++) {
    const top = l * lineH + 4;
    const slice = ex.measures.slice(l * perLine, (l + 1) * perLine);
    const extra = 44 + Math.abs(ex.keyFifths) * 10 + (l === 0 ? 26 : 0);
    // Width proportional to how busy each bar is, so dense bars get room.
    const weights = slice.map((evs) => 1 + 0.32 * evs.length + 0.12 * evs.reduce((n, e) => n + e.printed.filter((a) => a !== null).length, 0));
    const wsum = weights.reduce((a, b) => a + b, 0) + (perLine - slice.length) * 2.2;
    let x = 8;
    let staffTop = 0;
    let staffBottom = 0;
    slice.forEach((events, i) => {
      const mIndex = l * perLine + i;
      const mw = ((usable - extra) * weights[i]) / wsum;
      const w = i === 0 ? mw + extra : mw;
      const stave = styledStave(new Stave(x, top, w));
      if (i === 0) {
        stave.addClef(ex.clef, 'default', clefAnnotation(ex.clef, opts.guitar8vb)).addKeySignature(keySpec);
        if (l === 0) stave.addTimeSignature(`${ex.timeSig.beats}/${ex.timeSig.beatValue}`);
      }
      if (mIndex === ex.measures.length - 1) stave.setEndBarType(3); // final barline
      stave.setContext(ctx).draw();
      staffTop = stave.getYForLine(0);
      staffBottom = stave.getYForLine(4);

      const notes = events.map((ev) => buildScoreNote(ev, ex.clef, opts.colors?.get(ev.id)));
      notes.forEach((n, j) => vfNotes.set(events[j].id, n));
      const voice = new Voice({ numBeats: ex.timeSig.beats, beatValue: ex.timeSig.beatValue }).setMode(Voice.Mode.SOFT).addTickables(notes);
      const beams = Beam.generateBeams(notes, { groups: [beamGroup], beamRests: false });
      beams.forEach((b) => b.setStyle(style(INK)));

      let tabVoice: Voice | null = null;
      let tabStave: TabStave | null = null;
      if (opts.showTab) {
        tabStave = new TabStave(x, top + staffH - 10, w);
        tabStave.setStyle(style(DIM));
        if (i === 0) tabStave.addTabGlyph();
        tabStave.setNoteStartX(stave.getNoteStartX()); // align TAB numbers under the notes
        tabStave.setContext(ctx).draw();
        const tabNotes = events.map((ev) => {
          if (ev.rest) return new GhostNote({ duration: vexDuration(ev.duration) });
          const pos = tabPositions[tabIdx++];
          if (!pos) return new GhostNote({ duration: vexDuration(ev.duration) });
          const tn = new TabNote({ positions: [{ str: stringNumber(pos.string), fret: pos.fret }], duration: vexDuration(ev.duration) });
          tn.setStyle(style(INK));
          return tn;
        });
        tabVoice = new Voice({ numBeats: ex.timeSig.beats, beatValue: ex.timeSig.beatValue }).setMode(Voice.Mode.SOFT).addTickables(tabNotes);
      }
      const fmt = new Formatter();
      fmt.joinVoices([voice]);
      if (tabVoice) fmt.joinVoices([tabVoice]);
      fmt.format(tabVoice ? [voice, tabVoice] : [voice], stave.getNoteEndX() - stave.getNoteStartX() - 14);
      voice.draw(ctx, stave);
      if (tabVoice && tabStave) tabVoice.draw(ctx, tabStave);
      beams.forEach((b) => b.setContext(ctx).draw());

      layout.measures.push({ line: l, x0: stave.getX(), x1: stave.getX() + stave.getWidth(), noteStart: stave.getNoteStartX() });
      events.forEach((ev, j) => layout.events.set(ev.id, { x: notes[j].getAbsoluteX() + 6, line: l }));
      x += w;
    });
    layout.lines.push({ top, height: lineH, staffTop, staffBottom: staffBottom + (opts.showTab ? tabH : 0) });
  }

  // Ties (including across barlines / systems)
  ex.events.forEach((ev, i) => {
    if (!ev.tieToNext) return;
    const a = vfNotes.get(ev.id);
    const b = vfNotes.get(ex.events[i + 1]?.id);
    if (!a || !b) return;
    const sameLine = layout.events.get(ev.id)!.line === layout.events.get(ex.events[i + 1].id)!.line;
    const idx = ev.pitches.map((_, k) => k);
    const ties = sameLine
      ? [new StaveTie({ firstNote: a, lastNote: b, firstIndexes: idx, lastIndexes: idx })]
      : [new StaveTie({ firstNote: a, lastNote: null, firstIndexes: idx, lastIndexes: idx }), new StaveTie({ firstNote: null, lastNote: b, firstIndexes: idx, lastIndexes: idx })];
    ties.forEach((t) => {
      t.setStyle(style(INK));
      t.setContext(ctx).draw();
    });
  });
  return layout;
}

function buildScoreNote(ev: ScoreEvent, clef: Clef, color?: string): StaveNote {
  if (ev.rest) {
    const restKey = clef === 'treble' ? 'b/4' : 'd/3';
    const n = new StaveNote({ keys: [ev.duration.base === 'w' ? (clef === 'treble' ? 'd/5' : 'f/3') : restKey], duration: vexDuration(ev.duration, true), clef });
    if (ev.duration.dots) Dot.buildAndAttach([n], { all: true });
    n.setStyle(style(color ?? INK));
    return n;
  }
  const order = ev.pitches.map((p, i) => ({ p, a: ev.printed[i] })).sort((x, y) => midi(x.p) - midi(y.p));
  const n = new StaveNote({ keys: order.map((o) => vexKey(o.p)), duration: vexDuration(ev.duration), clef, autoStem: true });
  order.forEach((o, i) => {
    if (o.a !== null && o.a !== undefined) n.addModifier(new VFAccidental(vfAcc(o.a)), i);
  });
  if (ev.duration.dots) Dot.buildAndAttach([n], { all: true });
  n.setStyle(style(color ?? INK));
  n.setLedgerLineStyle(style(INK));
  return n;
}
