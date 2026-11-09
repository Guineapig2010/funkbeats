/** Shared generated buffers (noise), cached per audio context. */
import { rng } from '../util/math';

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (b) return b;
  const len = Math.floor(ctx.sampleRate * 2);
  b = ctx.createBuffer(2, len, ctx.sampleRate);
  const r = rng(12345);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = r.next() * 2 - 1;
  }
  noiseCache.set(ctx, b);
  return b;
}

export function noiseSource(ctx: BaseAudioContext, offset = 0): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  (src as any).__offset = offset % 1.9;
  return src;
}

/** Karplus–Strong plucked string, rendered once per pitch/params/sample rate and cached. */
const ksCache = new Map<string, AudioBuffer>();
export function pluckBuffer(ctx: BaseAudioContext, freq: number, damping: number, brightness: number, seconds: number): { buffer: AudioBuffer; rate: number } {
  const sr = ctx.sampleRate;
  // the 2-point averaging filter adds half a sample of delay
  const N = Math.max(2, Math.floor(sr / freq - 0.5));
  const actual = sr / (N + 0.5);
  const dur = Math.min(6, Math.max(0.3, seconds));
  const key = `${sr}|${N}|${damping.toFixed(2)}|${brightness.toFixed(2)}|${dur.toFixed(1)}`;
  let buf = ksCache.get(key);
  if (!buf) {
    const len = Math.floor(sr * dur);
    buf = ctx.createBuffer(1, len, sr);
    const out = buf.getChannelData(0);
    const line = new Float32Array(N + 1);
    const r = rng(N * 31 + 7);
    // excitation: noise low-passed according to brightness
    const a = 0.15 + brightness * 0.85;
    let lp = 0;
    for (let i = 0; i <= N; i++) {
      lp += a * (r.next() * 2 - 1 - lp);
      line[i] = lp;
    }
    let mean = 0;
    for (let i = 0; i <= N; i++) mean += line[i];
    mean /= N + 1;
    for (let i = 0; i <= N; i++) line[i] -= mean;
    // per-period loss: lower notes ring longer, damping shortens
    const loss = 0.9995 - damping * 0.012 - Math.min(0.006, freq / 400000);
    let idx = 0;
    let prev = line[0];
    for (let i = 0; i < len; i++) {
      const cur = line[idx];
      const next = loss * 0.5 * (cur + prev);
      prev = cur;
      out[i] = cur;
      line[idx] = next;
      idx = idx + 1 > N ? 0 : idx + 1;
    }
    // normalise
    let peak = 0;
    for (let i = 0; i < Math.min(len, N * 8); i++) peak = Math.max(peak, Math.abs(out[i]));
    if (peak > 0) for (let i = 0; i < len; i++) out[i] /= peak * 1.2;
    // fade the last 10ms to avoid an end click
    const f = Math.min(len, Math.floor(sr * 0.01));
    for (let i = 0; i < f; i++) out[len - 1 - i] *= i / f;
    ksCache.set(key, buf);
    if (ksCache.size > 600) ksCache.delete(ksCache.keys().next().value!);
  }
  return { buffer: buf, rate: freq / actual };
}

const waveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();
/** Drawbar organ periodic wave. Fundamental is the 16' footage (half the played pitch). */
export function organWave(ctx: BaseAudioContext, drawbars: number[]): PeriodicWave {
  let m = waveCache.get(ctx);
  if (!m) waveCache.set(ctx, (m = new Map()));
  const key = drawbars.join(',');
  let w = m.get(key);
  if (!w) {
    const harmonics = [1, 3, 2, 4, 6, 8, 10, 12, 16];
    const real = new Float32Array(17);
    const imag = new Float32Array(17);
    harmonics.forEach((h, i) => (imag[h] += drawbars[i] / 8));
    w = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    m.set(key, w);
  }
  return w;
}
