/**
 * YIN fundamental-frequency estimator (de Cheveigné & Kawahara, 2002).
 * Monophonic only: chords and strongly overlapping notes will produce
 * unreliable results — callers must treat low probability as "no pitch".
 */
export interface PitchEstimate {
  frequency: number;
  /** 1 − CMNDF at the chosen lag: ~1 for clean periodic signals. */
  probability: number;
}

export function yin(buffer: Float32Array, sampleRate: number, threshold = 0.12, minFreq = 70, maxFreq = 1400): PitchEstimate | null {
  const maxLag = Math.min(Math.floor(sampleRate / minFreq), Math.floor(buffer.length / 2));
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
  if (maxLag <= minLag) return null;
  const diff = new Float32Array(maxLag + 1);
  const n = buffer.length - maxLag;
  // Step 2: difference function
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = buffer[i] - buffer[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }
  // Step 3: cumulative mean normalised difference
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    running += diff[tau];
    cmnd[tau] = running === 0 ? 1 : (diff[tau] * tau) / running;
  }
  // Step 4: absolute threshold — first dip below threshold, then walk to its local minimum
  let tau = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= maxLag && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    // No dip under threshold: fall back to global minimum but report its (low) probability.
    let best = minLag;
    for (let t = minLag; t <= maxLag; t++) if (cmnd[t] < cmnd[best]) best = t;
    tau = best;
  }
  // Step 5: parabolic interpolation
  let better = tau;
  if (tau > 1 && tau < maxLag) {
    const s0 = cmnd[tau - 1];
    const s1 = cmnd[tau];
    const s2 = cmnd[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) better = tau + (s2 - s0) / denom;
  }
  const frequency = sampleRate / better;
  if (frequency < minFreq || frequency > maxFreq) return null;
  return { frequency, probability: Math.max(0, Math.min(1, 1 - cmnd[tau])) };
}

export function rms(buffer: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buffer.length; i++) s += buffer[i] * buffer[i];
  return Math.sqrt(s / buffer.length);
}

/**
 * Turns a stream of per-frame pitch estimates into discrete note onsets.
 * A note starts when the same MIDI pitch is stable for `stableFrames`
 * frames above the noise floor, or when the level re-attacks on the same pitch.
 */
export class OnsetTracker {
  private candidate: number | null = null;
  private count = 0;
  private current: number | null = null;
  private lastLevel = 0;
  private candidateStart = 0;

  constructor(
    private readonly opts: { stableFrames: number; confidence: number; noiseFloor: number; reattackRatio?: number },
  ) {}

  /** Feed one analysis frame. Returns a new note (MIDI + onset time) when one starts, and note-off when it ends. */
  push(time: number, level: number, estimate: PitchEstimate | null): { on?: { midi: number; time: number }; off?: { midi: number; time: number } } {
    const out: { on?: { midi: number; time: number }; off?: { midi: number; time: number } } = {};
    const voiced = level >= this.opts.noiseFloor && estimate && estimate.probability >= this.opts.confidence;
    const reattack = level > this.lastLevel * (this.opts.reattackRatio ?? 2.2) && this.lastLevel > 0 && level > this.opts.noiseFloor * 3;
    this.lastLevel = level;
    if (!voiced) {
      if (this.current !== null && level < this.opts.noiseFloor) {
        out.off = { midi: this.current, time };
        this.current = null;
      }
      this.candidate = null;
      this.count = 0;
      return out;
    }
    const m = Math.round(69 + 12 * Math.log2(estimate!.frequency / 440));
    if (m === this.candidate) this.count++;
    else {
      this.candidate = m;
      this.count = 1;
      this.candidateStart = time;
    }
    if (reattack && this.current === m) {
      out.off = { midi: m, time };
      this.current = null;
      this.count = 1;
      this.candidateStart = time;
    }
    if (this.count >= this.opts.stableFrames && this.current !== m) {
      if (this.current !== null) out.off = { midi: this.current, time: this.candidateStart };
      this.current = m;
      out.on = { midi: m, time: this.candidateStart };
    }
    return out;
  }
}
