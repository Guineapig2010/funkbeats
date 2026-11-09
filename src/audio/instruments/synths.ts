/**
 * Instrument engines. Each engine renders notes into `output` using native Web Audio
 * nodes, so the exact same code drives live playback and OfflineAudioContext export.
 */
import type { Instrument, SynthParams } from '../../model/schema';
import { dbToGain, midiToFreq } from '../../util/math';
import { applyEnvRelease, applyEnvStart, envShape, envValueAt, velocityGain, type EnvShape } from '../envelope';
import { noiseSource, organWave, pluckBuffer } from '../buffers';
import { DrumKitEngine } from './drums';

export interface AssetResolver {
  get(assetId: string): AudioBuffer | undefined;
}

export interface Voice {
  /** Schedule the release; returns end time. */
  release(time: number): number;
  /** Hard stop with a tiny fade (used on transport stop). */
  kill(time: number): void;
  end: number;
  pitch: number;
}

export interface InstrumentEngine {
  readonly output: GainNode;
  noteOn(time: number, pitch: number, velocity: number): Voice | null;
  /** Convenience: note with known duration. */
  playNote(time: number, pitch: number, velocity: number, duration: number): void;
  update(spec: Instrument): void;
  stopAll(time: number): void;
  dispose(): void;
  activeVoices(): number;
}

/** Shared voice bookkeeping + polyphony limiting. */
abstract class BaseEngine implements InstrumentEngine {
  readonly output: GainNode;
  protected pan: StereoPannerNode;
  protected spec: Instrument;
  protected voices = new Set<Voice>();
  constructor(protected ctx: BaseAudioContext, spec: Instrument) {
    this.spec = spec;
    this.output = ctx.createGain();
    this.pan = ctx.createStereoPanner();
    this.pan.connect(this.output);
    this.applyCommon();
  }
  protected get p(): SynthParams { return this.spec.params; }
  protected applyCommon() {
    this.pan.pan.value = this.p.pan;
  }
  update(spec: Instrument) {
    this.spec = spec;
    this.applyCommon();
  }
  protected abstract startVoice(time: number, pitch: number, velocity: number): Voice | null;
  noteOn(time: number, pitch: number, velocity: number) {
    // purge finished voices
    for (const v of this.voices) if (v.end > 0 && v.end < time - 0.05) this.voices.delete(v);
    const max = Math.max(1, Math.round(this.p.maxVoices));
    if (this.voices.size >= max) {
      // steal the oldest voice with a short fade
      const oldest = this.voices.values().next().value as Voice | undefined;
      if (oldest) {
        oldest.kill(time);
        this.voices.delete(oldest);
      }
    }
    const v = this.startVoice(time, pitch, velocity);
    if (v) this.voices.add(v);
    return v;
  }
  playNote(time: number, pitch: number, velocity: number, duration: number) {
    const v = this.noteOn(time, pitch, velocity);
    if (v) v.end = v.release(time + Math.max(0.01, duration));
  }
  stopAll(time: number) {
    for (const v of this.voices) v.kill(time);
    this.voices.clear();
  }
  activeVoices() {
    const now = this.ctx.currentTime;
    let n = 0;
    for (const v of this.voices) if (!(v.end > 0 && v.end < now)) n++;
    return n;
  }
  dispose() {
    this.stopAll(this.ctx.currentTime);
    try { this.output.disconnect(); } catch { /* noop */ }
  }
}

function pitchFreq(p: SynthParams, pitch: number, octave = 0, semi = 0) {
  return midiToFreq(pitch + p.transpose + octave * 12 + semi);
}

/** Generic voice made of sources -> filter -> amp, with optional LFOs. */
class NodeVoice implements Voice {
  end = 0;
  constructor(
    public pitch: number,
    private ctx: BaseAudioContext,
    private sources: AudioScheduledSourceNode[],
    private amp: GainNode,
    private ampShape: EnvShape,
    private ampRelease: number,
    private filter: BiquadFilterNode | null,
    private filtShape: EnvShape | null,
    private filtRelease: number,
    private disposeNodes: AudioNode[],
  ) {}
  release(time: number) {
    const end = applyEnvRelease(this.amp.gain, this.ampShape, time, this.ampRelease, 0);
    if (this.filter && this.filtShape) applyEnvRelease(this.filter.frequency, this.filtShape, time, this.filtRelease, this.filtShape.base);
    this.stopAt(end);
    this.end = end;
    return end;
  }
  kill(time: number) {
    const t = Math.max(time, this.ctx.currentTime);
    if (this.end > 0 && t >= this.end) return;
    const v = envValueAt(this.ampShape, t);
    this.amp.gain.cancelScheduledValues(t);
    this.amp.gain.setValueAtTime(v, t);
    this.amp.gain.linearRampToValueAtTime(0, t + 0.02);
    this.stopAt(t + 0.05);
    this.end = t + 0.05;
  }
  private stopped = false;
  private stopAt(t: number) {
    for (const s of this.sources) {
      try { s.stop(t); } catch { /* already stopped */ }
    }
    if (!this.stopped && this.sources[0]) {
      this.stopped = true;
      this.sources[0].onended = () => {
        for (const n of this.disposeNodes) try { n.disconnect(); } catch { /* noop */ }
      };
    }
  }
}

function makeFilterEnvelope(ctx: BaseAudioContext, p: SynthParams, pitch: number, time: number, velocity: number) {
  const f = ctx.createBiquadFilter();
  f.type = p.filter.type;
  f.Q.value = p.filter.resonance;
  const nyq = ctx.sampleRate / 2 - 100;
  const base = Math.min(nyq, Math.max(20, p.filter.cutoff * Math.pow(2, (p.filter.keyTrack * (pitch - 60)) / 12)));
  const velBoost = 0.5 + 0.5 * velocity;
  const peak = Math.min(nyq, Math.max(20, base * Math.pow(2, p.filter.envAmount * velBoost)));
  let shape: EnvShape | null = null;
  if (Math.abs(p.filter.envAmount) > 0.01) {
    shape = envShape(time, p.filterEnv, peak, base);
    applyEnvStart(f.frequency, shape);
  } else {
    f.frequency.setValueAtTime(base, time);
  }
  return { filter: f, shape };
}

function addLfos(ctx: BaseAudioContext, p: SynthParams, time: number, oscs: (OscillatorNode | AudioBufferSourceNode)[], filter: BiquadFilterNode | null, trem: GainNode | null, sources: AudioScheduledSourceNode[], nodes: AudioNode[]) {
  if (p.vibrato.depth > 0.5) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = p.vibrato.rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0, time + p.vibrato.delay);
    g.gain.linearRampToValueAtTime(p.vibrato.depth, time + p.vibrato.delay + 0.4);
    lfo.connect(g);
    for (const o of oscs) g.connect(o.detune);
    lfo.start(time);
    sources.push(lfo);
    nodes.push(lfo, g);
  }
  if ((p.lfo.toCutoff > 0.01 && filter) || (p.lfo.toAmp > 0.01 && trem)) {
    const lfo = ctx.createOscillator();
    lfo.type = p.lfo.wave;
    lfo.frequency.value = p.lfo.rate;
    if (p.lfo.toCutoff > 0.01 && filter) {
      const g = ctx.createGain();
      g.gain.value = p.lfo.toCutoff * 1200;
      lfo.connect(g).connect(filter.detune);
      nodes.push(g);
    }
    if (p.lfo.toAmp > 0.01 && trem) {
      const g = ctx.createGain();
      g.gain.value = p.lfo.toAmp / 2;
      trem.gain.value = 1 - p.lfo.toAmp / 2;
      lfo.connect(g).connect(trem.gain);
      nodes.push(g);
    }
    lfo.start(time);
    sources.push(lfo);
    nodes.push(lfo);
  }
}

// ---------------------------------------------------------------------------
export class SubtractiveEngine extends BaseEngine {
  private lastFreq = 0;
  protected startVoice(time: number, pitch: number, velocity: number): Voice {
    const ctx = this.ctx, p = this.p;
    const sources: AudioScheduledSourceNode[] = [];
    const nodes: AudioNode[] = [];
    const { filter, shape: fShape } = makeFilterEnvelope(ctx, p, pitch, time, velocity);
    const amp = ctx.createGain();
    amp.gain.value = 0;
    const trem = p.lfo.toAmp > 0.01 ? ctx.createGain() : null;
    filter.connect(amp);
    if (trem) { amp.connect(trem); trem.connect(this.pan); nodes.push(trem); } else amp.connect(this.pan);
    nodes.push(filter, amp);
    const oscs: OscillatorNode[] = [];
    const uni = Math.max(1, Math.round(p.unison));
    const glide = p.glide > 0 && p.maxVoices <= 2 && this.lastFreq > 0;
    for (const o of [p.osc1, p.osc2]) {
      if (o.level <= 0.001) continue;
      const f = pitchFreq(p, pitch, o.octave, o.semi);
      const og = ctx.createGain();
      og.gain.value = o.level / Math.sqrt(uni);
      og.connect(filter);
      nodes.push(og);
      for (let u = 0; u < uni; u++) {
        const osc = ctx.createOscillator();
        osc.type = o.wave;
        const spread = uni > 1 ? (u / (uni - 1) - 0.5) * 2 * p.unisonSpread : 0;
        osc.detune.value = o.detune + p.fine + spread;
        if (glide) {
          const ratio = f / pitchFreq(p, pitch);
          osc.frequency.setValueAtTime(this.lastFreq * ratio, time);
          osc.frequency.exponentialRampToValueAtTime(f, time + p.glide);
        } else osc.frequency.setValueAtTime(f, time);
        if (uni > 1) {
          const sp = ctx.createStereoPanner();
          sp.pan.value = (u / (uni - 1) - 0.5) * 1.2;
          osc.connect(sp).connect(og);
          nodes.push(sp);
        } else osc.connect(og);
        osc.start(time);
        sources.push(osc);
        oscs.push(osc);
        nodes.push(osc);
      }
    }
    if (p.subLevel > 0.001) {
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(pitchFreq(p, pitch, -1), time);
      const g = ctx.createGain();
      g.gain.value = p.subLevel;
      sub.connect(g).connect(amp); // sub bypasses filter for solid lows
      sub.start(time);
      sources.push(sub);
      oscs.push(sub);
      nodes.push(sub, g);
    }
    if (p.noiseLevel > 0.001) {
      const n = noiseSource(ctx);
      const g = ctx.createGain();
      g.gain.value = p.noiseLevel;
      n.connect(g).connect(filter);
      n.start(time, Math.random() * 1.5);
      sources.push(n);
      nodes.push(n, g);
    }
    this.lastFreq = pitchFreq(p, pitch);
    addLfos(ctx, p, time, oscs, filter, trem, sources, nodes);
    const peak = velocityGain(velocity, p.velocitySens) * dbToGain(p.gain) * p.expression;
    const shape = envShape(time, p.ampEnv, peak, 0);
    applyEnvStart(amp.gain, shape);
    const voice = new NodeVoice(pitch, ctx, sources, amp, shape, p.ampEnv.release, fShape ? filter : null, fShape, p.filterEnv.release, nodes);
    if (p.ampEnv.sustain < 0.001) {
      // percussive: voice ends on its own
      voice.end = time + Math.max(0.005, p.ampEnv.attack) + p.ampEnv.decay * 1.6 + 0.05;
      for (const s of sources) try { s.stop(voice.end + p.ampEnv.release); } catch { /* noop */ }
    }
    return voice;
  }
}

// ---------------------------------------------------------------------------
export class FmEngine extends BaseEngine {
  protected startVoice(time: number, pitch: number, velocity: number): Voice {
    const ctx = this.ctx, p = this.p;
    const sources: AudioScheduledSourceNode[] = [];
    const nodes: AudioNode[] = [];
    const f = pitchFreq(p, pitch, p.osc1.octave, p.osc1.semi);
    const { filter, shape: fShape } = makeFilterEnvelope(ctx, p, pitch, time, velocity);
    const amp = ctx.createGain();
    amp.gain.value = 0;
    const trem = p.lfo.toAmp > 0.01 ? ctx.createGain() : null;
    filter.connect(amp);
    if (trem) { amp.connect(trem); trem.connect(this.pan); nodes.push(trem); } else amp.connect(this.pan);
    nodes.push(filter, amp);

    const mod = ctx.createOscillator();
    mod.type = p.fm.modWave;
    mod.frequency.setValueAtTime(f * p.fm.ratio, time);
    const modGain = ctx.createGain();
    const idx = p.fm.index * f * (0.4 + 0.6 * velocity);
    modGain.gain.setValueAtTime(idx, time);
    modGain.gain.setTargetAtTime(idx * 0.12, time + 0.002, p.fm.indexDecay / 3);
    mod.connect(modGain);
    mod.start(time);
    sources.push(mod);
    nodes.push(mod, modGain);

    const carriers: OscillatorNode[] = [];
    const detunes = p.unison > 1 ? [-p.unisonSpread / 4, p.unisonSpread / 4] : [0];
    for (const d of detunes) {
      const car = ctx.createOscillator();
      car.type = p.osc1.wave;
      car.frequency.setValueAtTime(f, time);
      car.detune.value = p.osc1.detune + p.fine + d;
      modGain.connect(car.frequency);
      const g = ctx.createGain();
      g.gain.value = p.osc1.level / detunes.length;
      car.connect(g).connect(filter);
      car.start(time);
      sources.push(car);
      carriers.push(car);
      nodes.push(car, g);
    }
    if (p.noiseLevel > 0.001) {
      // hammer/mallet transient
      const n = noiseSource(ctx);
      const g = ctx.createGain();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(8000, f * 4);
      g.gain.setValueAtTime(p.noiseLevel * velocity, time);
      g.gain.setTargetAtTime(0, time + 0.002, 0.03);
      n.connect(bp).connect(g).connect(amp);
      n.start(time, Math.random());
      n.stop(time + 0.4);
      nodes.push(n, g, bp);
    }
    addLfos(ctx, p, time, carriers, filter, trem, sources, nodes);
    // higher notes decay faster, like real struck strings/bars
    const keyScale = Math.pow(0.5, Math.max(0, pitch - 60) / 24);
    const env = { ...p.ampEnv, decay: p.ampEnv.decay * (p.ampEnv.sustain < 0.05 ? keyScale : 1) };
    const peak = velocityGain(velocity, p.velocitySens) * dbToGain(p.gain) * p.expression;
    const shape = envShape(time, env, peak, 0);
    applyEnvStart(amp.gain, shape);
    const voice = new NodeVoice(pitch, ctx, sources, amp, shape, p.ampEnv.release, fShape ? filter : null, fShape, p.filterEnv.release, nodes);
    if (env.sustain < 0.001) voice.end = time + env.decay * 1.6 + 0.05;
    return voice;
  }
}

// ---------------------------------------------------------------------------
export class OrganEngine extends BaseEngine {
  protected startVoice(time: number, pitch: number, velocity: number): Voice {
    const ctx = this.ctx, p = this.p;
    const nodes: AudioNode[] = [];
    const sources: AudioScheduledSourceNode[] = [];
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(organWave(ctx, p.drawbars));
    osc.frequency.setValueAtTime(pitchFreq(p, pitch) / 2, time);
    osc.detune.value = p.fine;
    const amp = ctx.createGain();
    amp.gain.value = 0;
    const trem = p.lfo.toAmp > 0.01 ? ctx.createGain() : null;
    osc.connect(amp);
    if (trem) { amp.connect(trem); trem.connect(this.pan); nodes.push(trem); } else amp.connect(this.pan);
    osc.start(time);
    sources.push(osc);
    nodes.push(osc, amp);
    // key click
    const click = noiseSource(ctx);
    const cg = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    cg.gain.setValueAtTime(0.05 * velocity, time);
    cg.gain.setTargetAtTime(0, time, 0.004);
    click.connect(hp).connect(cg).connect(amp);
    click.start(time, Math.random());
    click.stop(time + 0.05);
    nodes.push(click, cg, hp);
    addLfos(ctx, p, time, [osc], null, trem, sources, nodes);
    const peak = (0.6 + 0.4 * velocityGain(velocity, p.velocitySens * 0.3)) * dbToGain(p.gain) * p.expression;
    const shape = envShape(time, p.ampEnv, peak, 0);
    applyEnvStart(amp.gain, shape);
    return new NodeVoice(pitch, ctx, sources, amp, shape, p.ampEnv.release, null, null, 0, nodes);
  }
}

// ---------------------------------------------------------------------------
export class PluckEngine extends BaseEngine {
  protected startVoice(time: number, pitch: number, velocity: number): Voice {
    const ctx = this.ctx, p = this.p;
    const nodes: AudioNode[] = [];
    const freq = pitchFreq(p, pitch) * Math.pow(2, p.fine / 1200);
    const { buffer, rate } = pluckBuffer(ctx, freq, p.pluck.damping, p.pluck.brightness * (0.6 + 0.4 * velocity), Math.min(6, p.ampEnv.decay + 1));
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 220;
    body.Q.value = 0.8;
    body.gain.value = p.pluck.body * 6;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(ctx.sampleRate / 2 - 100, p.filter.cutoff > 19000 ? 12000 : Math.max(p.filter.cutoff, freq * 1.5));
    const amp = ctx.createGain();
    src.connect(body).connect(lp).connect(amp).connect(this.pan);
    src.start(time);
    nodes.push(src, body, lp, amp);
    const env = { ...p.ampEnv, attack: Math.min(p.ampEnv.attack, 0.004) };
    const peak = velocityGain(velocity, p.velocitySens) * dbToGain(p.gain) * p.expression;
    const shape = envShape(time, { ...env, decay: 0.01, sustain: 1 }, peak, 0);
    applyEnvStart(amp.gain, shape);
    const v = new NodeVoice(pitch, ctx, [src], amp, shape, p.ampEnv.release, null, null, 0, nodes);
    v.end = time + buffer.duration / rate;
    try { src.stop(v.end); } catch { /* noop */ }
    return v;
  }
}

// ---------------------------------------------------------------------------
export class SamplerEngine extends BaseEngine {
  constructor(ctx: BaseAudioContext, spec: Instrument, private assets: AssetResolver) { super(ctx, spec); }
  protected startVoice(time: number, pitch: number, velocity: number): Voice | null {
    const ctx = this.ctx, p = this.p;
    const zones = this.spec.zones.filter((z) => pitch >= z.loPitch && pitch <= z.hiPitch && velocity >= z.loVel - 1e-6 && velocity <= z.hiVel + 1e-6);
    const zone = zones.length ? zones.reduce((a, b) => (Math.abs(a.rootPitch - pitch) <= Math.abs(b.rootPitch - pitch) ? a : b))
      : this.spec.zones.length ? this.spec.zones.reduce((a, b) => (Math.abs(a.rootPitch - pitch) <= Math.abs(b.rootPitch - pitch) ? a : b)) : null;
    if (!zone) return null;
    const buf = this.assets.get(zone.assetId);
    if (!buf) return null;
    const nodes: AudioNode[] = [];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, (pitch + p.transpose - zone.rootPitch + p.fine / 100) / 12);
    src.loop = zone.loop;
    const { filter, shape: fShape } = makeFilterEnvelope(ctx, p, pitch, time, velocity);
    const amp = ctx.createGain();
    amp.gain.value = 0;
    src.connect(filter).connect(amp).connect(this.pan);
    src.start(time);
    nodes.push(src, filter, amp);
    const peak = velocityGain(velocity, p.velocitySens) * dbToGain(p.gain + zone.gain) * p.expression;
    const shape = envShape(time, p.ampEnv, peak, 0);
    applyEnvStart(amp.gain, shape);
    const v = new NodeVoice(pitch, ctx, [src], amp, shape, p.ampEnv.release, fShape ? filter : null, fShape, p.filterEnv.release, nodes);
    if (!zone.loop) {
      v.end = time + buf.duration / src.playbackRate.value;
      try { src.stop(v.end + 0.01); } catch { /* noop */ }
    }
    return v;
  }
}

export class SilentEngine extends BaseEngine {
  protected startVoice(): Voice | null { return null; }
}

export function createInstrument(ctx: BaseAudioContext, spec: Instrument, assets: AssetResolver): InstrumentEngine {
  switch (spec.kind) {
    case 'subtractive': return new SubtractiveEngine(ctx, spec);
    case 'fm': return new FmEngine(ctx, spec);
    case 'organ': return new OrganEngine(ctx, spec);
    case 'pluck': return new PluckEngine(ctx, spec);
    case 'sampler': return new SamplerEngine(ctx, spec, assets);
    case 'drumkit': return new DrumKitEngine(ctx, spec, assets);
    default: return new SilentEngine(ctx, spec);
  }
}
