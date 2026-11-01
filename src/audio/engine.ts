import * as Tone from 'tone';
import { frequency } from '../music-theory/pitch';

/**
 * Audio engine built on Tone.js. All times are in the raw AudioContext clock
 * (seconds), which is also the clock used to timestamp taps, virtual-instrument
 * presses and microphone onsets — so evaluation never mixes clocks.
 *
 * Mobile browsers only allow audio after a user gesture: call `unlock()` from a
 * click/tap handler before anything else.
 */
class AudioEngine {
  private synth: Tone.PolySynth | null = null;
  private click: Tone.Synth | null = null;
  private fx: Tone.Synth | null = null;
  private master: Tone.Volume | null = null;
  private unlocked = false;
  sfxEnabled = true;
  private listeners = new Set<(state: string) => void>();

  get isUnlocked() {
    return this.unlocked && Tone.getContext().state === 'running';
  }

  async unlock(): Promise<void> {
    if (!this.unlocked) {
      await Tone.start();
      const ctx = Tone.getContext();
      ctx.lookAhead = 0.02;
      this.master = new Tone.Volume(-6).toDestination();
      const reverb = new Tone.Reverb({ decay: 1.6, wet: 0.18 }).connect(this.master);
      this.synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fattriangle', count: 2, spread: 12 },
        envelope: { attack: 0.004, decay: 0.6, sustain: 0.18, release: 1.1 },
      }).connect(reverb);
      this.synth.maxPolyphony = 16;
      this.synth.volume.value = -8;
      this.click = new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 } }).connect(this.master);
      this.click.volume.value = -14;
      this.fx = new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.005, decay: 0.15, sustain: 0, release: 0.1 } }).connect(this.master);
      this.fx.volume.value = -12;
      const raw = ctx.rawContext as unknown as AudioContext;
      raw.addEventListener?.('statechange', () => this.listeners.forEach((l) => l(raw.state)));
      this.unlocked = true;
    } else if (Tone.getContext().state !== 'running') {
      // iOS may suspend/interrupt the context (calls, backgrounding) — resume on the next gesture.
      await Tone.getContext().resume();
    }
  }

  onStateChange(fn: (state: string) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Raw audio clock in seconds. */
  now(): number {
    return Tone.getContext().rawContext.currentTime;
  }

  get rawContext(): AudioContext {
    return Tone.getContext().rawContext as unknown as AudioContext;
  }

  setVolume(v: number) {
    if (this.master) this.master.volume.value = v <= 0 ? -Infinity : 20 * Math.log10(v) - 6;
  }

  /** Play SOUNDING MIDI notes together. */
  playMidi(midis: number[], durationSec = 1.2, at?: number, velocity = 0.8) {
    if (!this.synth) return;
    const t = at ?? this.now() + 0.01;
    this.synth.triggerAttackRelease(midis.map((m) => frequency(m)), durationSec, t, velocity);
  }

  /** Arpeggiate then strum. */
  playChord(midis: number[]) {
    const t = this.now() + 0.02;
    const sorted = [...midis].sort((a, b) => a - b);
    sorted.forEach((m, i) => this.playMidi([m], 2.2 - i * 0.03, t + i * 0.03, 0.7));
  }

  metronomeClick(at: number, accent: boolean) {
    this.click?.triggerAttackRelease(accent ? 1760 : 1175, 0.03, at, accent ? 1 : 0.6);
  }

  sfx(kind: 'correct' | 'wrong' | 'level' | 'tick') {
    if (!this.fx || !this.sfxEnabled) return;
    const t = this.now() + 0.01;
    if (kind === 'correct') {
      this.fx.triggerAttackRelease(880, 0.07, t, 0.5);
      this.fx.triggerAttackRelease(1318.5, 0.09, t + 0.07, 0.5);
    } else if (kind === 'wrong') {
      this.fx.triggerAttackRelease(220, 0.16, t, 0.5);
    } else if (kind === 'level') {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.fx!.triggerAttackRelease(f, 0.12, t + i * 0.09, 0.5));
    } else {
      this.fx.triggerAttackRelease(1500, 0.02, t, 0.3);
    }
  }

  releaseAll() {
    this.synth?.releaseAll();
  }
}

export const audio = new AudioEngine();
