/**
 * Rhythm model. Durations are measured in ticks with PPQ (ticks per quarter) = 48,
 * which divides evenly into sixteenths (12), eighths (24), dotted values and triplets (16).
 */
export const PPQ = 48;

export type BaseDuration = 'w' | 'h' | 'q' | '8' | '16';

export const BASE_TICKS: Record<BaseDuration, number> = { w: 192, h: 96, q: 48, '8': 24, '16': 12 };

export interface DurationSpec {
  base: BaseDuration;
  dots: 0 | 1;
}

export function durationTicks(d: DurationSpec): number {
  const t = BASE_TICKS[d.base];
  return d.dots ? t + t / 2 : t;
}

/** VexFlow duration string, e.g. "qd" or "8r" */
export function vexDuration(d: DurationSpec, rest = false): string {
  return `${d.base}${d.dots ? 'd' : ''}${rest ? 'r' : ''}`;
}

export const DURATION_NAMES: Record<BaseDuration, string> = {
  w: 'whole', h: 'half', q: 'quarter', '8': 'eighth', '16': 'sixteenth',
};

export function durationName(d: DurationSpec): string {
  return `${d.dots ? 'dotted ' : ''}${DURATION_NAMES[d.base]}`;
}

/** Find the DurationSpec for an exact tick count (single note value only). */
export function ticksToDuration(ticks: number): DurationSpec | null {
  for (const base of ['w', 'h', 'q', '8', '16'] as BaseDuration[]) {
    if (BASE_TICKS[base] === ticks) return { base, dots: 0 };
    if (BASE_TICKS[base] * 1.5 === ticks) return { base, dots: 1 };
  }
  return null;
}

export interface TimeSignature {
  beats: number;
  beatValue: 2 | 4 | 8;
}

export function measureTicks(ts: TimeSignature): number {
  return ts.beats * (PPQ * 4) / ts.beatValue;
}

/** Compound meters (6/8, 9/8, 12/8) are felt in dotted-quarter beats. */
export function isCompound(ts: TimeSignature): boolean {
  return ts.beatValue === 8 && ts.beats % 3 === 0 && ts.beats > 3;
}

/** Ticks per *felt* beat — the pulse the metronome clicks on. */
export function beatTicks(ts: TimeSignature): number {
  if (isCompound(ts)) return (PPQ / 2) * 3;
  return (PPQ * 4) / ts.beatValue;
}

export function beatsPerMeasure(ts: TimeSignature): number {
  return measureTicks(ts) / beatTicks(ts);
}

/** Seconds per tick at a tempo expressed in felt beats per minute. */
export function secondsPerTick(bpm: number, ts: TimeSignature): number {
  return 60 / bpm / beatTicks(ts);
}

export function timeSigString(ts: TimeSignature): string {
  return `${ts.beats}/${ts.beatValue}`;
}

/** Beaming groups in ticks: by beat, except 4/4 eighths can join in half-measure groups. */
export function beamGroupTicks(ts: TimeSignature): number {
  return beatTicks(ts);
}
