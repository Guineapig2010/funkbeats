/**
 * ProjectGraph: builds and incrementally syncs the Web Audio node graph for a project:
 * instrument engines -> channel strips (fx chain, fader, pan, mute/solo, sends) ->
 * return buses -> master chain -> destination. The same class drives the live
 * AudioContext and OfflineAudioContext renders, so exports match playback.
 */
import type { Effect, Instrument, Project, Track } from '../model/schema';
import { dbToGain } from '../util/math';
import { createFx, DuckingFx, Fx, LimiterFx, type FxEnv } from './effects/effects';
import { createInstrument, type AssetResolver, type InstrumentEngine } from './instruments/synths';

export class FxChain {
  fx: Fx[] = [];
  private sig = '';
  constructor(private ctx: BaseAudioContext, private input: AudioNode, private output: AudioNode) {
    input.connect(output);
  }
  sync(effects: Effect[], env: FxEnv) {
    const enabled = effects.filter((e) => e.enabled);
    const sig = enabled.map((e) => e.id + ':' + Fx.structureKey(e)).join(';');
    if (sig === this.sig) {
      enabled.forEach((e, i) => this.fx[i].update(e, env));
      return;
    }
    this.sig = sig;
    const old = new Map(this.fx.map((f) => [f.effect.id + ':' + Fx.structureKey(f.effect), f]));
    const next: Fx[] = [];
    for (const e of enabled) {
      const k = e.id + ':' + Fx.structureKey(e);
      const reuse = old.get(k);
      if (reuse) {
        old.delete(k);
        reuse.update(e, env);
        next.push(reuse);
      } else next.push(createFx(this.ctx, e, env));
    }
    for (const f of old.values()) f.dispose();
    try { this.input.disconnect(); } catch { /* noop */ }
    for (const f of next) try { f.output.disconnect(); } catch { /* noop */ }
    let prev: AudioNode = this.input;
    for (const f of next) {
      prev.connect(f.input);
      prev = f.output;
    }
    prev.connect(this.output);
    this.fx = next;
  }
  byId(id: string) { return this.fx.find((f) => f.effect.id === id); }
  dispose() { for (const f of this.fx) f.dispose(); }
}

export class Meter {
  l: AnalyserNode;
  r: AnalyserNode;
  private bufL: Float32Array<ArrayBuffer>;
  private bufR: Float32Array<ArrayBuffer>;
  constructor(ctx: BaseAudioContext, src: AudioNode, fft = 1024) {
    const split = ctx.createChannelSplitter(2);
    this.l = ctx.createAnalyser();
    this.r = ctx.createAnalyser();
    this.l.fftSize = this.r.fftSize = fft;
    src.connect(split);
    split.connect(this.l, 0);
    split.connect(this.r, 1);
    this.bufL = new Float32Array(fft);
    this.bufR = new Float32Array(fft);
  }
  /** Returns [peakL, peakR, rmsL, rmsR] (linear). */
  read(): [number, number, number, number] {
    this.l.getFloatTimeDomainData(this.bufL);
    this.r.getFloatTimeDomainData(this.bufR);
    let pl = 0, pr = 0, sl = 0, sr = 0;
    for (let i = 0; i < this.bufL.length; i++) {
      const a = this.bufL[i], b = this.bufR[i];
      const aa = Math.abs(a), bb = Math.abs(b);
      if (aa > pl) pl = aa;
      if (bb > pr) pr = bb;
      sl += a * a; sr += b * b;
    }
    return [pl, pr, Math.sqrt(sl / this.bufL.length), Math.sqrt(sr / this.bufR.length)];
  }
  /** Stereo correlation (-1..1). */
  correlation(): number {
    let lr = 0, ll = 0, rr = 0;
    for (let i = 0; i < this.bufL.length; i++) { lr += this.bufL[i] * this.bufR[i]; ll += this.bufL[i] ** 2; rr += this.bufR[i] ** 2; }
    const d = Math.sqrt(ll * rr);
    return d > 1e-9 ? lr / d : 0;
  }
}

class Strip {
  readonly input: GainNode;
  readonly chain: FxChain;
  readonly fader: GainNode;
  readonly panner: StereoPannerNode;
  readonly muteGain: GainNode;
  readonly sends = new Map<string, GainNode>();
  meter: Meter | null = null;
  private dest: AudioNode | null = null;
  constructor(protected ctx: BaseAudioContext, metered: boolean) {
    this.input = ctx.createGain();
    const chainOut = ctx.createGain();
    this.chain = new FxChain(ctx, this.input, chainOut);
    this.fader = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.muteGain = ctx.createGain();
    chainOut.connect(this.fader).connect(this.panner).connect(this.muteGain);
    if (metered) this.meter = new Meter(ctx, this.muteGain);
  }
  route(dest: AudioNode) {
    if (dest === this.dest) return;
    if (this.dest) try { this.muteGain.disconnect(this.dest); } catch { /* noop */ }
    this.muteGain.connect(dest);
    this.dest = dest;
  }
  setSends(sends: { returnId: string; level: number }[], returns: Map<string, Strip>) {
    const now = this.ctx.currentTime;
    const want = new Set(sends.filter((s) => returns.has(s.returnId)).map((s) => s.returnId));
    for (const [id, g] of this.sends) if (!want.has(id)) { try { g.disconnect(); } catch { /* noop */ } this.sends.delete(id); }
    for (const s of sends) {
      const ret = returns.get(s.returnId);
      if (!ret) continue;
      let g = this.sends.get(s.returnId);
      if (!g) {
        g = this.ctx.createGain();
        g.gain.value = s.level;
        this.muteGain.connect(g).connect(ret.input); // post-fader, post-mute
        this.sends.set(s.returnId, g);
      } else g.gain.setTargetAtTime(s.level, now, 0.015);
    }
  }
  setLevel(volumeDb: number, pan: number, audible: boolean, immediate = false) {
    const now = this.ctx.currentTime;
    if (immediate) {
      this.fader.gain.value = dbToGain(volumeDb);
      this.panner.pan.value = pan;
      this.muteGain.gain.value = audible ? 1 : 0;
      return;
    }
    this.fader.gain.setTargetAtTime(dbToGain(volumeDb), now, 0.015);
    this.panner.pan.setTargetAtTime(pan, now, 0.015);
    this.muteGain.gain.setTargetAtTime(audible ? 1 : 0, now, 0.01);
  }
  dispose() {
    this.chain.dispose();
    for (const n of [this.input, this.fader, this.panner, this.muteGain, ...this.sends.values()]) try { n.disconnect(); } catch { /* noop */ }
  }
}

interface TrackNode {
  strip: Strip;
  engine: InstrumentEngine;
  instrKind: string;
  track: Track;
  instLanes: boolean;
}

export interface GraphOptions {
  /** Only these tracks are audible (stem rendering). */
  soloTrackIds?: Set<string> | null;
  /** Skip master effects (pre-master stems). */
  bypassMaster?: boolean;
  metered?: boolean;
  offline?: boolean;
}

export class ProjectGraph {
  readonly masterIn: GainNode;
  readonly masterChain: FxChain;
  readonly masterFader: GainNode;
  readonly masterOut: GainNode;
  masterMeter: Meter | null = null;
  analyser: AnalyserNode | null = null;
  readonly tracks = new Map<string, TrackNode>();
  readonly returns = new Map<string, Strip>();
  private returnDefs = new Map<string, Project['returns'][number]>();
  private env: FxEnv = { bpm: 120, offline: false };
  private audioSources = new Set<AudioBufferSourceNode>();
  private clickGain: GainNode;
  project: Project | null = null;

  constructor(readonly ctx: BaseAudioContext, readonly assets: AssetResolver & { getReversed?(id: string): AudioBuffer | undefined }, readonly opts: GraphOptions = {}) {
    this.env.offline = !!opts.offline;
    this.masterIn = ctx.createGain();
    const chainOut = ctx.createGain();
    this.masterChain = new FxChain(ctx, this.masterIn, chainOut);
    this.masterFader = ctx.createGain();
    this.masterOut = ctx.createGain();
    chainOut.connect(this.masterFader).connect(this.masterOut).connect(ctx.destination);
    if (opts.metered) {
      this.masterMeter = new Meter(ctx, this.masterOut, 2048);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0.75;
      this.masterOut.connect(this.analyser);
    }
    this.clickGain = ctx.createGain();
    this.clickGain.connect(ctx.destination); // metronome bypasses the mix & master
  }

  get fxEnv() { return this.env; }

  sync(p: Project) {
    this.project = p;
    this.env = { bpm: p.bpm, offline: !!this.opts.offline };
    // master
    this.masterChain.sync(this.opts.bypassMaster ? p.master.effects.filter((e) => e.type === 'never' as any) : p.master.effects, this.env);
    this.masterFader.gain.setTargetAtTime(this.opts.bypassMaster ? 1 : dbToGain(p.master.volume), this.ctx.currentTime, 0.015);
    if (this.opts.offline) this.masterFader.gain.value = this.opts.bypassMaster ? 1 : dbToGain(p.master.volume);

    // returns
    const retIds = new Set(p.returns.map((r) => r.id));
    for (const [id, s] of this.returns) if (!retIds.has(id)) { s.dispose(); this.returns.delete(id); }
    for (const r of p.returns) {
      let s = this.returns.get(r.id);
      if (!s) {
        s = new Strip(this.ctx, !!this.opts.metered);
        this.returns.set(r.id, s);
        s.route(this.masterIn);
      }
      this.returnDefs.set(r.id, r);
      s.chain.sync(r.effects, this.env);
      s.setLevel(r.volume, 0, !r.mute, this.opts.offline);
    }

    // tracks
    const ids = new Set(p.tracks.map((t) => t.id));
    for (const [id, tn] of this.tracks) if (!ids.has(id)) { tn.engine.dispose(); tn.strip.dispose(); this.tracks.delete(id); }
    const anySolo = p.tracks.some((t) => t.solo);
    for (const t of p.tracks) {
      let tn = this.tracks.get(t.id);
      if (!tn) {
        const strip = new Strip(this.ctx, !!this.opts.metered);
        const engine = createInstrument(this.ctx, t.instrument, this.assets);
        engine.output.connect(strip.input);
        tn = { strip, engine, instrKind: t.instrument.kind, track: t, instLanes: false };
        this.tracks.set(t.id, tn);
      } else if (tn.instrKind !== t.instrument.kind) {
        tn.engine.dispose();
        tn.engine = createInstrument(this.ctx, t.instrument, this.assets);
        tn.engine.output.connect(tn.strip.input);
        tn.instrKind = t.instrument.kind;
      } else if (tn.track.instrument !== t.instrument) {
        tn.engine.update(t.instrument);
      }
      tn.track = t;
      tn.instLanes = t.automation.some((a) => a.enabled && a.target.startsWith('inst.') && a.points.length > 0);
      tn.strip.chain.sync(t.effects, this.env);
      const dest = t.output !== 'master' && this.returns.has(t.output) ? this.returns.get(t.output)!.input : this.masterIn;
      tn.strip.route(dest);
      tn.strip.setSends(t.sends, this.returns);
      let audible = !t.mute && (!anySolo || t.solo);
      if (this.opts.soloTrackIds) audible = this.opts.soloTrackIds.has(t.id) && !t.mute;
      if (t.groupId) {
        const g = p.groups.find((x) => x.id === t.groupId);
        if (g && (g as any).mute) audible = false;
      }
      tn.strip.setLevel(t.volume, t.pan, audible, this.opts.offline);
    }
  }

  // ---------- playback primitives used by the scheduler ----------
  playNote(trackId: string, time: number, pitch: number, velocity: number, duration: number, instOverride?: Partial<Record<'cutoff' | 'resonance', number>>) {
    const tn = this.tracks.get(trackId);
    if (!tn) return;
    if (instOverride && (instOverride.cutoff !== undefined || instOverride.resonance !== undefined)) {
      const base = tn.track.instrument;
      const spec: Instrument = { ...base, params: { ...base.params, filter: { ...base.params.filter, ...(instOverride.cutoff !== undefined ? { cutoff: instOverride.cutoff } : {}), ...(instOverride.resonance !== undefined ? { resonance: instOverride.resonance } : {}) } } };
      tn.engine.update(spec);
      tn.engine.playNote(time, pitch, velocity, duration);
      tn.engine.update(base);
    } else tn.engine.playNote(time, pitch, velocity, duration);
  }

  triggerDuckers(sourceTrackId: string, time: number, pitch: number, velocity: number) {
    for (const tn of this.tracks.values()) for (const f of tn.strip.chain.fx) this.maybeDuck(f, sourceTrackId, time, pitch, velocity);
    for (const r of this.returns.values()) for (const f of r.chain.fx) this.maybeDuck(f, sourceTrackId, time, pitch, velocity);
  }
  private maybeDuck(f: Fx, src: string, time: number, pitch: number, velocity: number) {
    if (f instanceof DuckingFx && f.sourceTrack === src && (f.triggerPitch < 0 || f.triggerPitch === pitch)) f.trigger(time, velocity);
  }
  hasDuckers(): Set<string> {
    const s = new Set<string>();
    const scan = (fx: Fx[]) => { for (const f of fx) if (f instanceof DuckingFx && f.sourceTrack) s.add(f.sourceTrack); };
    for (const tn of this.tracks.values()) scan(tn.strip.chain.fx);
    for (const r of this.returns.values()) scan(r.chain.fx);
    return s;
  }

  playAudio(trackId: string, time: number, assetId: string, offsetSec: number, durationSec: number, gainDb: number, fadeIn: number, fadeOut: number, rate: number, reverse: boolean) {
    const tn = this.tracks.get(trackId);
    if (!tn) return;
    const buf = reverse ? this.assets.getReversed?.(assetId) : this.assets.get(assetId);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    const peak = dbToGain(gainDb);
    const fi = Math.max(0.002, Math.min(fadeIn, durationSec / 2));
    const fo = Math.max(0.002, Math.min(fadeOut, durationSec / 2));
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(peak, time + fi);
    g.gain.setValueAtTime(peak, Math.max(time + fi, time + durationSec - fo));
    g.gain.linearRampToValueAtTime(0, time + durationSec);
    src.connect(g).connect(tn.strip.input);
    const off = Math.max(0, Math.min(buf.duration - 0.001, offsetSec));
    src.start(time, off, Math.max(0.001, durationSec * rate));
    src.stop(time + durationSec + 0.01);
    this.audioSources.add(src);
    src.onended = () => { this.audioSources.delete(src); try { g.disconnect(); } catch { /* noop */ } };
  }

  click(time: number, accent: boolean, volume: number) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.35 * volume, time + 0.001);
    g.gain.setTargetAtTime(0, time + 0.002, 0.012);
    o.connect(g).connect(this.clickGain);
    o.start(time);
    o.stop(time + 0.08);
  }

  /** Automation write: owner is a track id, 'master', or 'ret:<id>'. Value units match the target. */
  automate(owner: string, target: string, value: number, time: number, startTime: number) {
    const strip = owner === 'master' ? null : owner.startsWith('ret:') ? this.returns.get(owner.slice(4)) : this.tracks.get(owner)?.strip;
    const chain = owner === 'master' ? this.masterChain : strip?.chain;
    const ramp = (p: AudioParam, v: number) => {
      if (startTime === -2) { p.cancelScheduledValues(time); p.setValueAtTime(v, time); return; }
      if (startTime >= 0) p.setValueAtTime(p.value, startTime);
      p.linearRampToValueAtTime(v, time);
    };
    if (target === 'volume') {
      if (owner === 'master') ramp(this.masterFader.gain, dbToGain(value));
      else if (strip) ramp(strip.fader.gain, dbToGain(value));
    } else if (target === 'pan' && strip) ramp(strip.panner.pan, Math.max(-1, Math.min(1, value)));
    else if (target.startsWith('send.') && strip) {
      const g = strip.sends.get(target.slice(5));
      if (g) ramp(g.gain, Math.max(0, Math.min(1, value)));
    } else if (target.startsWith('fx.') && chain) {
      const [, fxId, key] = target.split('.');
      chain.byId(fxId)?.rampTo(key, value, time, startTime);
    }
  }

  /** Cancel automation/ducking and restore static mixer values (called on stop/seek). */
  resetDynamics() {
    const now = this.ctx.currentTime;
    const cancel = (p: AudioParam) => p.cancelScheduledValues(now);
    cancel(this.masterFader.gain);
    for (const tn of this.tracks.values()) {
      cancel(tn.strip.fader.gain); cancel(tn.strip.panner.pan);
      for (const g of tn.strip.sends.values()) cancel(g.gain);
      for (const f of tn.strip.chain.fx) f.reset(now);
    }
    for (const r of this.returns.values()) for (const f of r.chain.fx) f.reset(now);
    if (this.project) {
      // force re-application of static values
      const p = this.project;
      this.project = null;
      this.sync(p);
      for (const tn of this.tracks.values()) for (const f of tn.strip.chain.fx) f.init();
      for (const r of this.returns.values()) for (const f of r.chain.fx) f.init();
      for (const f of this.masterChain.fx) f.init();
    }
  }

  stopAll() {
    const now = this.ctx.currentTime;
    for (const tn of this.tracks.values()) tn.engine.stopAll(now);
    for (const s of this.audioSources) try { s.stop(now + 0.02); } catch { /* noop */ }
    this.audioSources.clear();
  }

  engineFor(trackId: string) { return this.tracks.get(trackId)?.engine ?? null; }
  stripFor(trackId: string) { return this.tracks.get(trackId)?.strip ?? null; }
  returnStrip(id: string) { return this.returns.get(id) ?? null; }
  masterLimiterReduction(): number {
    for (const f of this.masterChain.fx) if (f instanceof LimiterFx) return f.reductionDb();
    return 0;
  }
  activeVoices() {
    let n = 0;
    for (const tn of this.tracks.values()) n += tn.engine.activeVoices();
    return n;
  }
  dispose() {
    this.stopAll();
    for (const tn of this.tracks.values()) { tn.engine.dispose(); tn.strip.dispose(); }
    for (const r of this.returns.values()) r.dispose();
    this.masterChain.dispose();
    try { this.masterOut.disconnect(); } catch { /* noop */ }
  }
}
