import { describe, expect, it } from 'vitest';
import { OnsetTracker, rms, yin } from '../pitch-detection/yin';
import { midiFromFrequency } from '../music-theory/pitch';

const SR = 44100;
function tone(freq: number, n = 2048, harmonics = [1], noise = 0, seed = 1): Float32Array {
  const b = new Float32Array(n);
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    let v = 0;
    harmonics.forEach((amp, h) => (v += amp * Math.sin((2 * Math.PI * freq * (h + 1) * i) / SR)));
    b[i] = v * 0.4 + noise * rand();
  }
  return b;
}

describe('YIN pitch detection', () => {
  it('detects sine tones across the guitar range', () => {
    for (const f of [82.41, 110, 146.83, 196, 246.94, 329.63, 440, 659.25, 880]) {
      const est = yin(tone(f), SR)!;
      expect(est).not.toBeNull();
      expect(Math.abs(midiFromFrequency(est.frequency) - midiFromFrequency(f))).toBeLessThan(0.15);
      expect(est.probability).toBeGreaterThan(0.9);
    }
  });
  it('locks onto the fundamental of a harmonic-rich guitar-like tone', () => {
    // Strong 2nd harmonic is the classic octave-error trap.
    const est = yin(tone(110, 2048, [0.6, 1, 0.5, 0.3]), SR)!;
    expect(Math.round(midiFromFrequency(est.frequency))).toBe(45);
  });
  it('tolerates moderate noise and reports low confidence for pure noise', () => {
    const noisy = yin(tone(196, 2048, [1, 0.4], 0.05), SR)!;
    expect(Math.round(midiFromFrequency(noisy.frequency))).toBe(55);
    const pure = yin(tone(196, 2048, [0], 0.3), SR);
    expect(pure === null || pure.probability < 0.7).toBe(true);
  });
  it('computes RMS', () => {
    expect(rms(new Float32Array([1, -1, 1, -1]))).toBe(1);
  });
});

describe('onset tracking', () => {
  it('emits one onset per stable note and handles re-attacks', () => {
    const t = new OnsetTracker({ stableFrames: 3, confidence: 0.8, noiseFloor: 0.01 });
    const est = (f: number) => ({ frequency: f, probability: 0.95 });
    const ons: number[] = [];
    const feed = (time: number, level: number, f: number | null) => {
      const r = t.push(time, level, f ? est(f) : null);
      if (r.on) ons.push(r.on.midi);
    };
    for (let i = 0; i < 6; i++) feed(i * 0.02, 0.2, 440);
    feed(0.2, 0.001, null); // silence
    for (let i = 0; i < 6; i++) feed(0.3 + i * 0.02, 0.2, 493.88);
    feed(0.5, 0.05, 493.88);
    for (let i = 0; i < 4; i++) feed(0.52 + i * 0.02, 0.3, 493.88); // re-attack same pitch
    expect(ons).toEqual([69, 71, 71]);
  });
});
