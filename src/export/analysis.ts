/** Peak / RMS / integrated loudness (ITU-R BS.1770 style K-weighting + gating) analysis. */
import type { PcmLike } from './wav';

export interface Analysis { peakDb: number; rmsDb: number; lufs: number; clippedSamples: number; durationSec: number }

function biquad(x: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi;
  }
  return y;
}

/** K-weighting coefficients for arbitrary sample rate (derived from the BS.1770 analog prototypes). */
function kWeight(x: Float32Array, fs: number): Float32Array {
  // stage 1: high shelf
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  let Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = biquad(x, (Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  // stage 2: high pass
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  return biquad(s1, 1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
}

export function analyze(buf: PcmLike): Analysis {
  const chs = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  let peak = 0, sum = 0, clipped = 0;
  for (const d of chs) for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
    if (a >= 0.9999) clipped++;
    sum += d[i] * d[i];
  }
  const n = Math.max(1, buf.length * chs.length);
  const fs = buf.sampleRate;
  // integrated loudness: 400ms blocks, 75% overlap, absolute gate -70, relative gate -10
  const kw = chs.slice(0, 2).map((d) => kWeight(d, fs));
  const block = Math.floor(fs * 0.4), hop = Math.floor(block / 4);
  const powers: number[] = [];
  for (let s = 0; s + block <= buf.length; s += hop) {
    let z = 0;
    for (const d of kw) { let acc = 0; for (let i = s; i < s + block; i++) acc += d[i] * d[i]; z += acc / block; }
    powers.push(z);
  }
  const lk = (z: number) => -0.691 + 10 * Math.log10(Math.max(1e-12, z));
  const abs = powers.filter((z) => lk(z) > -70);
  let lufs = -Infinity;
  if (abs.length) {
    const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
    const gated = abs.filter((z) => lk(z) > rel);
    if (gated.length) lufs = lk(gated.reduce((a, b) => a + b, 0) / gated.length);
  }
  return {
    peakDb: 20 * Math.log10(Math.max(1e-9, peak)),
    rmsDb: 10 * Math.log10(Math.max(1e-12, sum / n)),
    lufs,
    clippedSamples: clipped,
    durationSec: buf.length / fs,
  };
}

/** Scale in place so the peak hits targetDb. Returns applied gain (dB). */
export function normalizePeak(buf: PcmLike, targetDb = -1): number {
  let peak = 0;
  const chs = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  for (const d of chs) for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak < 1e-6) return 0;
  const g = Math.pow(10, targetDb / 20) / peak;
  for (const d of chs) for (let i = 0; i < d.length; i++) d[i] *= g;
  return 20 * Math.log10(g);
}

/** Peaks for waveform display: min/max pairs per bucket (mono mix). */
export function waveformPeaks(buf: PcmLike, buckets: number, startSample = 0, endSample = buf.length): Float32Array {
  const out = new Float32Array(buckets * 2);
  const chs = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i));
  const span = Math.max(1, endSample - startSample);
  for (let b = 0; b < buckets; b++) {
    const s = startSample + Math.floor((b * span) / buckets);
    const e = Math.min(endSample, startSample + Math.floor(((b + 1) * span) / buckets));
    let mn = 0, mx = 0;
    const step = Math.max(1, Math.floor((e - s) / 256));
    for (let i = s; i < e; i += step) {
      let v = 0;
      for (const d of chs) v += d[i] ?? 0;
      v /= chs.length;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    out[b * 2] = mn; out[b * 2 + 1] = mx;
  }
  return out;
}
