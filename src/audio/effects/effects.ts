/**
 * Audio effect processors built from native Web Audio nodes (+ AudioWorklets for
 * limiter and gate). Every effect really processes audio in both live playback and
 * offline export. Numeric parameters update smoothly; structural options
 * (choices/toggles) cause the processor to be rebuilt by the mixer.
 */
import type { Effect, EffectType } from '../../model/schema';
import { dbToGain, rng } from '../../util/math';
import { workletsReady } from '../worklets';

export interface FxEnv { bpm: number; offline: boolean }

type ParamTarget = [AudioParam, number];

export abstract class Fx {
  readonly input: GainNode;
  readonly output: GainNode;
  protected dry: GainNode | null = null;
  protected wet: GainNode | null = null;
  protected nodes: AudioNode[] = [];
  protected sources: AudioScheduledSourceNode[] = [];
  constructor(protected ctx: BaseAudioContext, public effect: Effect, protected env: FxEnv) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
  }
  /** Wire input -> core -> wet -> output and input -> dry -> output. */
  protected mixable(coreIn: AudioNode, coreOut: AudioNode) {
    this.dry = this.ctx.createGain();
    this.wet = this.ctx.createGain();
    this.input.connect(this.dry).connect(this.output);
    this.input.connect(coreIn);
    coreOut.connect(this.wet).connect(this.output);
  }
  /** Correlated processors (dynamics, distortion) crossfade linearly; time-based effects use equal power. */
  protected linearMix = false;
  protected mixTargets(v: number): ParamTarget[] {
    if (!this.dry || !this.wet) return [];
    if (this.linearMix) return [[this.dry.gain, 1 - v], [this.wet.gain, v]];
    return [[this.dry.gain, Math.cos((v * Math.PI) / 2)], [this.wet.gain, Math.sin((v * Math.PI) / 2)]];
  }
  /** Map a numeric parameter to AudioParam targets. Return null if the change needs custom handling. */
  protected abstract targets(key: string, v: number): ParamTarget[] | null;
  protected onCustom(_key: string, _v: number) { /* override */ }
  num(key: string, fallback = 0): number {
    const v = this.effect.params[key];
    return typeof v === 'number' ? v : fallback;
  }
  str(key: string, fallback = ''): string {
    const v = this.effect.params[key];
    return typeof v === 'string' ? v : fallback;
  }
  bool(key: string, fallback = false): boolean {
    const v = this.effect.params[key];
    return typeof v === 'boolean' ? v : fallback;
  }
  /** Initial/static application of all params. */
  init() {
    for (const [k, v] of Object.entries(this.effect.params)) {
      if (typeof v !== 'number') continue;
      const t = this.targets(k, v);
      if (t) for (const [p, val] of t) p.value = val;
      else this.onCustom(k, v);
    }
  }
  update(e: Effect, env: FxEnv) {
    const prev = this.effect;
    this.effect = e;
    this.env = env;
    const now = this.ctx.currentTime;
    for (const [k, v] of Object.entries(e.params)) {
      if (typeof v !== 'number' || prev.params[k] === v) continue;
      const t = this.targets(k, v);
      if (t) for (const [p, val] of t) { p.cancelScheduledValues(now); p.setTargetAtTime(val, now, 0.015); }
      else this.onCustom(k, v);
    }
  }
  /** Automation: ramp parameter to value by `time`. */
  rampTo(key: string, v: number, time: number, startTime: number) {
    const t = this.targets(key, v);
    if (!t) return;
    for (const [p, val] of t) {
      if (startTime === -2) { p.cancelScheduledValues(time); p.setValueAtTime(val, time); continue; }
      if (startTime >= 0) p.setValueAtTime(p.value, Math.max(0, startTime));
      p.linearRampToValueAtTime(val, time);
    }
  }
  /** Signature of structural options; when it changes the mixer rebuilds the processor. */
  static structureKey(e: Effect) {
    return e.type + '|' + Object.entries(e.params).filter(([, v]) => typeof v !== 'number').map(([k, v]) => `${k}=${v}`).sort().join(',');
  }
  reset(_time: number) { /* override */ }
  dispose() {
    for (const s of this.sources) try { s.stop(); } catch { /* noop */ }
    for (const n of [this.input, this.output, this.dry, this.wet, ...this.nodes]) if (n) try { n.disconnect(); } catch { /* noop */ }
  }
}

// ---------------------------------------------------------------------------
class EqFx extends Fx {
  hp = this.ctx.createBiquadFilter();
  lo = this.ctx.createBiquadFilter();
  m1 = this.ctx.createBiquadFilter();
  m2 = this.ctx.createBiquadFilter();
  hi = this.ctx.createBiquadFilter();
  constructor(ctx: BaseAudioContext, e: Effect, env: FxEnv) {
    super(ctx, e, env);
    this.hp.type = 'highpass'; this.hp.Q.value = 0.707;
    this.lo.type = 'lowshelf'; this.m1.type = 'peaking'; this.m2.type = 'peaking'; this.hi.type = 'highshelf';
    this.input.connect(this.hp).connect(this.lo).connect(this.m1).connect(this.m2).connect(this.hi).connect(this.output);
    this.nodes.push(this.hp, this.lo, this.m1, this.m2, this.hi);
  }
  targets(k: string, v: number): ParamTarget[] | null {
    switch (k) {
      case 'hpf': return [[this.hp.frequency, v]];
      case 'lowFreq': return [[this.lo.frequency, v]];
      case 'lowGain': return [[this.lo.gain, v]];
      case 'mid1Freq': return [[this.m1.frequency, v]];
      case 'mid1Gain': return [[this.m1.gain, v]];
      case 'mid1Q': return [[this.m1.Q, v]];
      case 'mid2Freq': return [[this.m2.frequency, v]];
      case 'mid2Gain': return [[this.m2.gain, v]];
      case 'mid2Q': return [[this.m2.Q, v]];
      case 'highFreq': return [[this.hi.frequency, v]];
      case 'highGain': return [[this.hi.gain, v]];
    }
    return [];
  }
  /** Magnitude response for drawing the EQ curve. */
  response(freqs: Float32Array<ArrayBuffer>): Float32Array {
    const total = new Float32Array(freqs.length).fill(1);
    const mag = new Float32Array(freqs.length);
    const ph = new Float32Array(freqs.length);
    for (const f of [this.hp, this.lo, this.m1, this.m2, this.hi]) {
      f.getFrequencyResponse(freqs, mag, ph);
      for (let i = 0; i < freqs.length; i++) total[i] *= mag[i];
    }
    return total;
  }
}

class CompressorFx extends Fx {
  protected linearMix = true;
  comp = this.ctx.createDynamicsCompressor();
  makeup = this.ctx.createGain();
  constructor(ctx: BaseAudioContext, e: Effect, env: FxEnv) {
    super(ctx, e, env);
    this.comp.connect(this.makeup);
    this.mixable(this.comp, this.makeup);
    this.nodes.push(this.comp, this.makeup);
  }
  targets(k: string, v: number): ParamTarget[] | null {
    switch (k) {
      case 'threshold': return [[this.comp.threshold, v]];
      case 'ratio': return [[this.comp.ratio, v]];
      case 'attack': return [[this.comp.attack, v]];
      case 'release': return [[this.comp.release, v]];
      case 'knee': return [[this.comp.knee, v]];
      case 'makeup': return [[this.makeup.gain, dbToGain(v)]];
      case 'mix': return this.mixTargets(v);
    }
    return [];
  }
  reduction() { return typeof this.comp.reduction === 'number' ? this.comp.reduction : 0; }
}

class LimiterFx extends Fx {
  node: AudioWorkletNode | null = null;
  pre = this.ctx.createGain();
  fallback: DynamicsCompressorNode | null = null;
  post = this.ctx.createGain();
  lastReduction = 1;
  constructor(ctx: BaseAudioContext, e: Effect, env: FxEnv) {
    super(ctx, e, env);
    if (workletsReady(ctx)) {
      this.node = new AudioWorkletNode(ctx, 'aims-limiter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      this.node.port.onmessage = (ev) => { this.lastReduction = ev.data as number; };
      this.input.connect(this.node).connect(this.output);
      this.nodes.push(this.node);
    } else {
      // native fallback: fast, hard-knee compressor (not a true brickwall)
      this.fallback = ctx.createDynamicsCompressor();
      this.fallback.ratio.value = 20;
      this.fallback.knee.value = 0;
      this.fallback.attack.value = 0.001;
      this.input.connect(this.pre).connect(this.fallback).connect(this.post).connect(this.output);
      this.nodes.push(this.pre, this.fallback, this.post);
    }
  }
  private p(name: string) { return this.node!.parameters.get(name)!; }
  targets(k: string, v: number): ParamTarget[] | null {
    if (this.node) {
      if (k === 'gain') return [[this.p('inputGain'), dbToGain(v)]];
      if (k === 'ceiling') return [[this.p('ceiling'), dbToGain(v)]];
      if (k === 'release') return [[this.p('release'), v]];
      return [];
    }
    if (k === 'gain') return [[this.pre.gain, dbToGain(v)]];
    if (k === 'ceiling') return [[this.fallback!.threshold, v - 1], [this.post.gain, 1]];
    if (k === 'release') return [[this.fallback!.release, v]];
    return [];
  }
  reductionDb() {
    if (this.fallback) return this.fallback.reduction;
    return 20 * Math.log10(Math.max(1e-6, this.lastReduction));
  }
}

const irCache = new Map<string, AudioBuffer>();
export function generateImpulse(ctx: BaseAudioContext, decay: number, predelay: number, tone: number, size: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const key = [sr, decay.toFixed(2), predelay.toFixed(3), Math.round(tone), size.toFixed(2)].join('|');
  const hit = irCache.get(key);
  if (hit) return hit;
  const pre = Math.floor(predelay * sr);
  const len = Math.min(sr * 14, pre + Math.floor(sr * decay * 1.2) + 64);
  const buf = ctx.createBuffer(2, len, sr);
  const r = rng(Math.floor(decay * 1000 + tone + size * 77));
  const k = 6.9 / decay; // -60 dB at `decay`
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      // high frequencies decay faster: cutoff glides down over time
      const fc = Math.max(300, tone * Math.exp(-t * 1.6 / Math.max(0.3, decay)));
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lp += a * (r.next() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-k * t);
    }
    // early reflections
    const taps = 6 + Math.floor(size * 10);
    for (let j = 0; j < taps; j++) {
      const t = 0.004 + r.next() * (0.01 + size * 0.07);
      const idx = pre + Math.floor(t * sr);
      if (idx < len) d[idx] += (r.next() > 0.5 ? 1 : -1) * (0.5 + 0.4 * size) * Math.exp(-t * 18);
    }
    // fade-in to avoid a click at predelay boundary
    for (let i = 0; i < 64 && pre + i < len; i++) d[pre + i] *= i / 64;
  }
  irCache.set(key, buf);
  if (irCache.size > 24) irCache.delete(irCache.keys().next().value!);
  return buf;
}

class ReverbFx extends Fx {
  conv = this.ctx.createConvolver();
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(ctx: BaseAudioContext, e: Effect, env: FxEnv) {
    super(ctx, e, env);
    this.mixable(this.conv, this.conv);
    this.nodes.push(this.conv);
    this.rebuild();
  }
  rebuild() {
    this.conv.buffer = generateImpulse(this.ctx, this.num('decay', 2.4), this.num('predelay', 0.02), this.num('tone', 7000), this.num('size', 0.5));
  }
  targets(k: string, v: number): ParamTarget[] | null {
    if (k === 'mix') return this.mixTargets(v);
    return null;
  }
  private ready = false;
  onCustom() {
    if (!this.ready) return;
    if (this.env.offline) return this.rebuild();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.rebuild(), 150);
  }
  init() {
    super.init();
    this.ready = true;
  }
}

class DelayFx extends Fx {
  dl = this.ctx.createDelay(8);
  dr = this.ctx.createDelay(8);
  fbL = this.ctx.createGain();
  fbR = this.ctx.createGain();
  toneL = this.ctx.createBiquadFilter();
  toneR = this.ctx.createBiquadFilter();
  constructor(ctx: BaseAudioContext, e: Effect, env: FxEnv) {
    super(ctx, e, env);
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    const inGain = ctx.createGain();
    this.toneL.type = this.toneR.type = 'lowpass';
    this.nodes.push(this.dl, this.dr, this.fbL, this.fbR, this.toneL, this.toneR, split, merge, inGain);
    if (this.bool('pingpong', true)) {
      // mono sum into left, then bounce L -> R -> L
      inGain.gain.value = 0.5;
      inGain.channelCount = 1;
      inGain.channelCountMode = 'explicit';
      inGain.connect(this.dl);
      this.dl.connect(this.toneL).connect(this.fbL).connect(this.dr);
      this.dr.connect(this.toneR).connect(this.fbR).connect(this.dl);
      this.dl.connect(merge, 0, 0);
      this.dr.connect(merge, 0, 1);
      this.mixable(inGain, merge);
    } else {
      inGain.connect(split);
      split.connect(this.dl, 0);
      split.connect(this.dr, 1);
      this.dl.connect(this.toneL).connect(this.fbL).connect(this.dl);
      this.dr.connect(this.toneR).connect(this.fbR).connect(this.dr);
      this.dl.connect(merge, 0, 0);
      this.dr.connect(merge, 0, 1);
      this.mixable(inGain, merge);
    }
  }
  targets(k: string, v: number): ParamTarget[] | null {
    switch (k) {
      case 'time': { const s = Math.min(7.9, (v * 60) / Math.max(20, this.env.bpm)); return [[this.dl.delayTime, s], [this.dr.delayTime, s]]; }
      case 'feedback': return [[this.fbL.gain, v], [this.fbR.gain, v]];
      case 'tone': return [[this.toneL.frequency, v], [this.toneR.frequency, v]];
      case 'mix': return this.mixTargets(v);
    }
    return [];
  }
  update(e: Effect, env: FxEnv) {
    const bpmChanged = env.bpm !== this.env.bpm;
    super.update(e, env);
    if (bpmChanged) for (const [p, v] of this.targets('time', this.num('time', 0.75))!) p.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
}

class ModDelayFx extends Fx {
  // chorus (2 voices, no feedback) or flanger (1 voice + feedback)
  delays: DelayNode[] = [];
  lfoGains: GainNode[] = [];
  lfos: OscillatorNode[] = [];
  fb: GainNode | null = null;
  constructor(ctx: BaseAudioContext, e: Effect, env: FxEnv, private flanger: boolean) {
    super(ctx, e, env);
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    const inGain = ctx.createGain();
    inGain.connect(split);
    this.nodes.push(split, merge, inGain);
    for (let ch = 0; ch < 2; ch++) {
      const d = ctx.createDelay(0.1);
      const lfo = ctx.createOscillator();
      const g = ctx.createGain();
      lfo.connect(g).connect(d.delayTime);
      if (ch === 1) {
        // quadrature-ish offset for stereo motion
        lfo.frequency.value = 1; // replaced by targets
      }
      lfo.start(ctx.currentTime + ch * 0.13);
      split.connect(d, ch);
      d.connect(merge, 0, ch);
      this.delays.push(d);
      this.lfos.push(lfo);
      this.lfoGains.push(g);
      this.sources.push(lfo);
      this.nodes.push(d, lfo, g);
    }
    if (flanger) {
      this.fb = ctx.createGain();
      for (const d of this.delays) { d.connect(this.fb); }
      this.fb.connect(this.delays[0]);
      this.fb.connect(this.delays[1]);
      this.nodes.push(this.fb);
    }
    this.mixable(inGain, merge);
  }
  targets(k: string, v: number): ParamTarget[] | null {
    switch (k) {
      case 'rate': return [[this.lfos[0].frequency, v], [this.lfos[1].frequency, v * 1.07]];
      case 'depth': return this.lfoGains.map((g) => [g.gain, v] as ParamTarget);
      case 'delay': return this.delays.map((d) => [d.delayTime, v] as ParamTarget);
      case 'feedback': return this.fb ? [[this.fb.gain, v * 0.5]] : [];
      case 'mix': return this.mixTargets(v);
    }
    return [];
  }
  init() {
    super.init();
    if (this.flanger) for (const d of this.delays) d.delayTime.value = 0.003;
  }
}

class PhaserFx extends Fx {
  stages: BiquadFilterNode[] = [];
  lfo = this.ctx.createOscillator();
  lfoGain = this.ctx.createGain();
  fb = this.ctx.createGain();
  fbDelay = this.ctx.createDelay(0.01);
  constructor(ctx: BaseAudioContext, e: Effect, env: FxEnv) {
    super(ctx, e, env);
    const inGain = ctx.createGain();
    let prev: AudioNode = inGain;
    for (let i = 0; i < 6; i++) {
      const f = ctx.createBiquadFilter();
      f.type = 'allpass';
      f.Q.value = 0.6;
      prev.connect(f);
      prev = f;
      this.stages.push(f);
      this.lfoGain.connect(f.frequency);
    }
    prev.connect(this.fbDelay).connect(this.fb).connect(this.stages[0]);
    this.fbDelay.delayTime.value = 0.0005;
    this.lfo.connect(this.lfoGain);
    this.lfo.start();
    this.sources.push(this.lfo);
    this.nodes.push(inGain, ...this.stages, this.lfo, this.lfoGain, this.fb, this.fbDelay);
    this.mixable(inGain, prev);
  }
  targets(k: string, v: number): ParamTarget[] | null {
    switch (k) {
      case 'rate': return [[this.lfo.frequency, v]];
      case 'base': return [...this.stages.map((s) => [s.frequency, v] as ParamTarget), [this.lfoGain.gain, v * 0.9 * this.num('depth', 0.7)]];
      case 'depth': return [[this.lfoGain.gain, this.num('base', 700) * 0.9 * v]];
      case 'feedback': return [[this.fb.gain, v]];
      case 'mix': return this.mixTargets(v);
    }
    return [];
  }
}

function shaperCurve(kind: string, drive: number): Float32Array {
  const n = 4096;
  const c = new Float32Array(n);
  const k = 1 + drive * 60;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    let y: number;
    switch (kind) {
      case 'hard': y = Math.max(-1, Math.min(1, x * k * 0.5)); break;
      case 'fuzz': { const z = x * k; y = z > 0 ? 1 - Math.exp(-z) : -1 + Math.exp(z * 0.6); y = Math.max(-1, Math.min(1, y)); break; }
      case 'fold': y = Math.sin(x * (1 + drive * 8) * Math.PI / 2); break;
      default: y = Math.tanh(x * k) / Math.tanh(k);
    }
    c[i] = y;
  }
  return c;
}

class DistortionFx extends Fx {
  protected linearMix = true;
  pre = this.ctx.createGain();
  shaper = this.ctx.createWaveShaper();
  tone = this.ctx.createBiquadFilter();
  post = this.ctx.createGain();
  constructor(ctx: BaseAudioContext, e: Effect, env: FxEnv) {
    super(ctx, e, env);
    this.shaper.oversample = '4x';
    this.tone.type = 'lowpass';
    this.pre.connect(this.shaper).connect(this.tone).connect(this.post);
    this.mixable(this.pre, this.post);
    this.nodes.push(this.pre, this.shaper, this.tone, this.post);
  }
  targets(k: string, v: number): ParamTarget[] | null {
    switch (k) {
      case 'drive': return null;
      case 'tone': return [[this.tone.frequency, v]];
      case 'output': return [[this.post.gain, dbToGain(v)]];
      case 'mix': return this.mixTargets(v);
    }
    return [];
  }
  onCustom(k: string, v: number) {
    if (k === 'drive') this.shaper.curve = shaperCurve(this.str('curve', 'soft'), v) as Float32Array<ArrayBuffer>;
  }
}

class SaturationFx extends Fx {
  protected linearMix = true;
  pre = this.ctx.createGain();
  shaper = this.ctx.createWaveShaper();
  warm = this.ctx.createBiquadFilter();
  air = this.ctx.createBiquadFilter();
  post = this.ctx.createGain();
  constructor(ctx: BaseAudioContext, e: Effect, env: FxEnv) {
    super(ctx, e, env);
    const n = 2048;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      // slight asymmetry adds even harmonics (tube-like)
      c[i] = Math.tanh(x + 0.08 * x * x) - Math.tanh(0.08 * 0) ;
    }
    this.shaper.curve = c;
    this.shaper.oversample = '2x';
    this.warm.type = 'lowshelf'; this.warm.frequency.value = 180;
    this.air.type = 'highshelf'; this.air.frequency.value = 9000;
    this.pre.connect(this.shaper).connect(this.warm).connect(this.air).connect(this.post);
    this.mixable(this.pre, this.post);
    this.nodes.push(this.pre, this.shaper, this.warm, this.air, this.post);
  }
  targets(k: string, v: number): ParamTarget[] | null {
    switch (k) {
      case 'drive': return [[this.pre.gain, dbToGain(v)], [this.post.gain, 1 / Math.sqrt(dbToGain(v))]];
      case 'warmth': return [[this.warm.gain, v * 4], [this.air.gain, -v * 4]];
      case 'mix': return this.mixTargets(v);
    }
    return [];
  }
}

class FilterFx extends Fx {
  f = this.ctx.createBiquadFilter();
  lfo = this.ctx.createOscillator();
  lfoGain = this.ctx.createGain();
  constructor(ctx: BaseAudioContext, e: Effect, env: FxEnv) {
    super(ctx, e, env);
    this.f.type = this.str('mode', 'lowpass') as BiquadFilterType;
    this.input.connect(this.f).connect(this.output);
    this.lfo.connect(this.lfoGain).connect(this.f.detune);
    this.lfo.start();
    this.sources.push(this.lfo);
    this.nodes.push(this.f, this.lfo, this.lfoGain);
  }
  targets(k: string, v: number): ParamTarget[] | null {
    switch (k) {
      case 'cutoff': return [[this.f.frequency, v]];
      case 'resonance': return [[this.f.Q, v]];
      case 'lfoRate': return [[this.lfo.frequency, v]];
      case 'lfoDepth': return [[this.lfoGain.gain, v * 1200]];
    }
    return [];
  }
}

class WidthFx extends Fx {
  sideGain = this.ctx.createGain();
  sideHp = this.ctx.createBiquadFilter();
  constructor(ctx: BaseAudioContext, e: Effect, env: FxEnv) {
    super(ctx, e, env);
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    const midL = ctx.createGain(), midR = ctx.createGain();
    const sL = ctx.createGain(), sR = ctx.createGain();
    const mid = ctx.createGain(); const side = ctx.createGain();
    midL.gain.value = 0.5; midR.gain.value = 0.5; sL.gain.value = 0.5; sR.gain.value = -0.5;
    this.input.connect(split);
    split.connect(midL, 0); split.connect(midR, 1); split.connect(sL, 0); split.connect(sR, 1);
    midL.connect(mid); midR.connect(mid); sL.connect(side); sR.connect(side);
    this.sideHp.type = 'highpass';
    side.connect(this.sideHp).connect(this.sideGain);
    const inv = ctx.createGain(); inv.gain.value = -1;
    // L = M + S, R = M - S
    mid.connect(merge, 0, 0); mid.connect(merge, 0, 1);
    this.sideGain.connect(merge, 0, 0);
    this.sideGain.connect(inv).connect(merge, 0, 1);
    merge.connect(this.output);
    this.nodes.push(split, merge, midL, midR, sL, sR, mid, side, inv, this.sideHp, this.sideGain);
  }
  targets(k: string, v: number): ParamTarget[] | null {
    if (k === 'width') return [[this.sideGain.gain, v]];
    if (k === 'monoBelow') return [[this.sideHp.frequency, Math.max(10, v)]];
    return [];
  }
}

export class DuckingFx extends Fx {
  duck = this.ctx.createGain();
  constructor(ctx: BaseAudioContext, e: Effect, env: FxEnv) {
    super(ctx, e, env);
    this.input.connect(this.duck).connect(this.output);
    this.nodes.push(this.duck);
  }
  targets(): ParamTarget[] | null { return []; }
  get sourceTrack() { return this.str('source', ''); }
  get triggerPitch() { return this.num('triggerPitch', -1); }
  trigger(time: number, velocity = 1) {
    const depth = this.num('depth', 0.6) * (0.5 + 0.5 * velocity);
    const a = this.num('attack', 0.005);
    const r = this.num('release', 0.22);
    const g = this.duck.gain;
    g.setTargetAtTime(1 - depth, time, a / 3);
    g.setTargetAtTime(1, time + a * 2, r / 4);
  }
  reset(time: number) {
    this.duck.gain.cancelScheduledValues(time);
    this.duck.gain.setTargetAtTime(1, time, 0.02);
  }
}

class GateFx extends Fx {
  node: AudioWorkletNode | null = null;
  constructor(ctx: BaseAudioContext, e: Effect, env: FxEnv) {
    super(ctx, e, env);
    if (workletsReady(ctx)) {
      this.node = new AudioWorkletNode(ctx, 'aims-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      this.input.connect(this.node).connect(this.output);
      this.nodes.push(this.node);
    } else this.input.connect(this.output); // pass-through when worklets are unavailable
  }
  targets(k: string, v: number): ParamTarget[] | null {
    const p = this.node?.parameters.get(k);
    return p ? [[p, v]] : [];
  }
}

class BitcrushFx extends Fx {
  protected linearMix = true;
  shaper = this.ctx.createWaveShaper();
  lp = this.ctx.createBiquadFilter();
  constructor(ctx: BaseAudioContext, e: Effect, env: FxEnv) {
    super(ctx, e, env);
    this.lp.type = 'lowpass';
    this.shaper.connect(this.lp);
    this.mixable(this.shaper, this.lp);
    this.nodes.push(this.shaper, this.lp);
  }
  targets(k: string, v: number): ParamTarget[] | null {
    if (k === 'tone') return [[this.lp.frequency, v]];
    if (k === 'mix') return this.mixTargets(v);
    return null;
  }
  onCustom(k: string, v: number) {
    if (k !== 'bits') return;
    const levels = Math.pow(2, Math.round(v)) / 2;
    const n = 8192;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.round(x * levels) / levels;
    }
    this.shaper.curve = c;
  }
}

class GainFx extends Fx {
  g = this.ctx.createGain();
  constructor(ctx: BaseAudioContext, e: Effect, env: FxEnv) {
    super(ctx, e, env);
    if (this.bool('mono')) {
      this.g.channelCount = 1;
      this.g.channelCountMode = 'explicit';
      this.g.channelInterpretation = 'speakers';
    }
    this.input.connect(this.g).connect(this.output);
    this.nodes.push(this.g);
  }
  targets(k: string, v: number): ParamTarget[] | null {
    if (k === 'gain') return [[this.g.gain, dbToGain(v) * (this.bool('invert') ? -1 : 1)]];
    return [];
  }
}

export function createFx(ctx: BaseAudioContext, e: Effect, env: FxEnv): Fx {
  const map: Record<EffectType, () => Fx> = {
    eq: () => new EqFx(ctx, e, env),
    compressor: () => new CompressorFx(ctx, e, env),
    limiter: () => new LimiterFx(ctx, e, env),
    reverb: () => new ReverbFx(ctx, e, env),
    delay: () => new DelayFx(ctx, e, env),
    chorus: () => new ModDelayFx(ctx, e, env, false),
    flanger: () => new ModDelayFx(ctx, e, env, true),
    phaser: () => new PhaserFx(ctx, e, env),
    distortion: () => new DistortionFx(ctx, e, env),
    saturation: () => new SaturationFx(ctx, e, env),
    filter: () => new FilterFx(ctx, e, env),
    width: () => new WidthFx(ctx, e, env),
    ducking: () => new DuckingFx(ctx, e, env),
    gate: () => new GateFx(ctx, e, env),
    bitcrush: () => new BitcrushFx(ctx, e, env),
    gain: () => new GainFx(ctx, e, env),
  };
  const fx = map[e.type]();
  fx.init();
  return fx;
}

export { EqFx, CompressorFx, LimiterFx };
