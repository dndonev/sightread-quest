import { audio } from './engine';
import { type TimeSignature, beatTicks, beatsPerMeasure, secondsPerTick } from '../music-theory/rhythm';

export interface ClockOptions {
  bpm: number;
  timeSig: TimeSignature;
  totalTicks: number;
  countInMeasures: number;
  metronome: boolean;
  /** Notes to play along (SOUNDING MIDI) with their tick positions — for "listen" playback. */
  playback?: { tick: number; ticks: number; midis: number[] }[];
  onEnd?: () => void;
}

/**
 * Score clock driven by the audio clock. Ticks are derived from
 * AudioContext.currentTime so the playhead, metronome and input timestamps
 * share one time base. A small look-ahead scheduler queues clicks and notes.
 */
export class ScoreClock {
  private t0 = 0;
  private running = false;
  private pausedTick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBeat = 0;
  private nextNote = 0;
  readonly spt: number;
  readonly beat: number;

  constructor(private readonly opts: ClockOptions) {
    this.spt = secondsPerTick(opts.bpm, opts.timeSig);
    this.beat = beatTicks(opts.timeSig);
  }

  get isRunning() {
    return this.running;
  }

  get msPerTick() {
    return this.spt * 1000;
  }

  /** Tick for an audio-clock time (negative during count-in). */
  tickAt(audioTime: number): number {
    return (audioTime - this.t0) / this.spt;
  }

  currentTick(): number {
    return this.running ? this.tickAt(audio.now()) : this.pausedTick;
  }

  start(fromTick = 0) {
    const countInTicks = this.opts.countInMeasures * beatsPerMeasure(this.opts.timeSig) * this.beat;
    const startAt = audio.now() + 0.12;
    this.t0 = startAt + countInTicks * this.spt - fromTick * this.spt;
    this.nextBeat = Math.floor((fromTick - countInTicks) / this.beat);
    this.nextNote = (this.opts.playback ?? []).findIndex((n) => n.tick >= fromTick);
    if (this.nextNote < 0) this.nextNote = Infinity;
    this.running = true;
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  pause() {
    if (!this.running) return;
    this.pausedTick = Math.max(0, this.currentTick());
    this.stopTimer();
    audio.releaseAll();
  }

  resume() {
    if (this.running) return;
    this.start(this.pausedTick);
  }

  stop() {
    this.pausedTick = 0;
    this.stopTimer();
  }

  private stopTimer() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule() {
    if (!this.running) return;
    const horizon = audio.now() + 0.12;
    const bpm = beatsPerMeasure(this.opts.timeSig);
    while (this.t0 + this.nextBeat * this.beat * this.spt < horizon) {
      const tickPos = this.nextBeat * this.beat;
      if (tickPos >= this.opts.totalTicks) break;
      const time = this.t0 + tickPos * this.spt;
      const isCountIn = tickPos < 0;
      if (this.opts.metronome || isCountIn) {
        const beatInBar = ((this.nextBeat % bpm) + bpm) % bpm;
        if (time >= audio.now() - 0.01) audio.metronomeClick(time, beatInBar === 0);
      }
      this.nextBeat++;
    }
    const pb = this.opts.playback ?? [];
    while (this.nextNote < pb.length && this.t0 + pb[this.nextNote].tick * this.spt < horizon) {
      const n = pb[this.nextNote];
      const time = this.t0 + n.tick * this.spt;
      if (time >= audio.now() - 0.01) audio.playMidi(n.midis, Math.max(0.15, n.ticks * this.spt * 0.95), time);
      this.nextNote++;
    }
    if (this.currentTick() >= this.opts.totalTicks + this.beat * 0.5) {
      this.pausedTick = this.opts.totalTicks;
      this.stopTimer();
      this.opts.onEnd?.();
    }
  }
}
