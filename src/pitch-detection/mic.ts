import { audio } from '../audio/engine';
import { OnsetTracker, rms, yin } from './yin';

export interface MicOptions {
  confidence: number;
  noiseFloor: number;
  latencyMs: number;
  onNoteOn: (n: { midi: number; time: number }) => void;
  onNoteOff?: (n: { midi: number; time: number }) => void;
  onLevel?: (level: number, midi: number | null) => void;
}

export type MicError = 'unsupported' | 'denied' | 'unavailable';

/**
 * Monophonic microphone input. Uses the same AudioContext as playback, so
 * onset times are on the audio clock (minus the latency compensation).
 * Limitations: chords, harmonics-heavy attacks and room noise reduce accuracy.
 */
export class MicPitchTracker {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private raf = 0;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private tracker: OnsetTracker;

  constructor(private opts: MicOptions) {
    this.tracker = new OnsetTracker({ stableFrames: 3, confidence: opts.confidence, noiseFloor: opts.noiseFloor });
  }

  static supported(): boolean {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  /** Must be called from a user gesture (after audio.unlock()). */
  async start(): Promise<MicError | null> {
    if (!MicPitchTracker.supported()) return 'unsupported';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable';
    }
    const ctx = audio.rawContext;
    this.source = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.source.connect(this.analyser);
    this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    const loop = () => {
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    return null;
  }

  private tick() {
    if (!this.analyser || !this.buf) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    const level = rms(this.buf);
    const ctx = audio.rawContext;
    // Analysis window ends "now"; its centre is half a window earlier.
    const time = ctx.currentTime - this.buf.length / ctx.sampleRate / 2 - this.opts.latencyMs / 1000;
    const est = level >= this.opts.noiseFloor ? yin(this.buf, ctx.sampleRate) : null;
    const r = this.tracker.push(time, level, est);
    if (r.off) this.opts.onNoteOff?.(r.off);
    if (r.on) this.opts.onNoteOn(r.on);
    const midi = est && est.probability >= this.opts.confidence ? Math.round(69 + 12 * Math.log2(est.frequency / 440)) : null;
    this.opts.onLevel?.(level, midi);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    this.analyser = null;
  }
}

/** Measure ambient level for `ms` and suggest a noise floor. */
export async function calibrateNoiseFloor(ms = 1500): Promise<number | MicError> {
  const levels: number[] = [];
  const t = new MicPitchTracker({ confidence: 1, noiseFloor: 1, latencyMs: 0, onNoteOn: () => {}, onLevel: (l) => levels.push(l) });
  const err = await t.start();
  if (err) return err;
  await new Promise((r) => setTimeout(r, ms));
  t.stop();
  if (!levels.length) return 0.01;
  const sorted = [...levels].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  return Math.min(0.08, Math.max(0.004, p90 * 2.5));
}
