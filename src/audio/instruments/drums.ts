/**
 * Synthesized drum kits (kick, snare, hats, toms, cymbals, percussion, orchestral)
 * with per-piece tuning/decay/level/pan and optional user sample replacement.
 */
import type { DrumKitName, Instrument } from '../../model/schema';
import { dbToGain } from '../../util/math';
import { noiseSource } from '../buffers';
import type { AssetResolver, InstrumentEngine, Voice } from './synths';

interface KitCharacter {
  kickFreq: number; kickDrop: number; kickDecay: number; kickClick: number; kickDrive: number;
  snareTone: number; snareNoise: number; snareDecay: number; snareHp: number;
  hatFreq: number; hatDecay: number; metallic: number;
  tomBase: number; clapSpread: number; cymbalDecay: number; brightness: number; level: number;
}

const KITS: Record<DrumKitName, KitCharacter> = {
  electronic: { kickFreq: 52, kickDrop: 3.5, kickDecay: 0.45, kickClick: 0.5, kickDrive: 0.2, snareTone: 190, snareNoise: 0.8, snareDecay: 0.2, snareHp: 1200, hatFreq: 8000, hatDecay: 0.05, metallic: 0.6, tomBase: 90, clapSpread: 0.011, cymbalDecay: 1.6, brightness: 1, level: 1 },
  '808': { kickFreq: 46, kickDrop: 2.5, kickDecay: 1.3, kickClick: 0.25, kickDrive: 0.35, snareTone: 220, snareNoise: 0.6, snareDecay: 0.18, snareHp: 1800, hatFreq: 9000, hatDecay: 0.045, metallic: 1, tomBase: 85, clapSpread: 0.012, cymbalDecay: 1.4, brightness: 1.1, level: 1 },
  trap: { kickFreq: 48, kickDrop: 3, kickDecay: 0.9, kickClick: 0.6, kickDrive: 0.4, snareTone: 240, snareNoise: 0.9, snareDecay: 0.16, snareHp: 2200, hatFreq: 10000, hatDecay: 0.035, metallic: 0.9, tomBase: 95, clapSpread: 0.009, cymbalDecay: 1.4, brightness: 1.2, level: 1 },
  acoustic: { kickFreq: 58, kickDrop: 2.2, kickDecay: 0.35, kickClick: 0.8, kickDrive: 0.1, snareTone: 185, snareNoise: 0.95, snareDecay: 0.24, snareHp: 900, hatFreq: 7500, hatDecay: 0.07, metallic: 0.35, tomBase: 100, clapSpread: 0.012, cymbalDecay: 2.4, brightness: 0.9, level: 1 },
  rock: { kickFreq: 60, kickDrop: 2.4, kickDecay: 0.4, kickClick: 1, kickDrive: 0.3, snareTone: 200, snareNoise: 1, snareDecay: 0.28, snareHp: 800, hatFreq: 7000, hatDecay: 0.08, metallic: 0.4, tomBase: 95, clapSpread: 0.012, cymbalDecay: 2.8, brightness: 1, level: 1.05 },
  lofi: { kickFreq: 55, kickDrop: 2.4, kickDecay: 0.35, kickClick: 0.25, kickDrive: 0.15, snareTone: 180, snareNoise: 0.6, snareDecay: 0.17, snareHp: 1000, hatFreq: 6000, hatDecay: 0.04, metallic: 0.3, tomBase: 90, clapSpread: 0.014, cymbalDecay: 1.2, brightness: 0.6, level: 0.95 },
  orchestral: { kickFreq: 40, kickDrop: 1.8, kickDecay: 1.6, kickClick: 0.4, kickDrive: 0, snareTone: 210, snareNoise: 1, snareDecay: 0.3, snareHp: 700, hatFreq: 7000, hatDecay: 0.08, metallic: 0.5, tomBase: 75, clapSpread: 0.012, cymbalDecay: 4.5, brightness: 0.9, level: 1 },
};

const METAL_RATIOS = [1, 1.483, 1.932, 2.546, 2.63, 3.897];

class OneShot implements Voice {
  end: number;
  constructor(public pitch: number, private ctx: BaseAudioContext, private out: GainNode, private sources: AudioScheduledSourceNode[], end: number, private nodes: AudioNode[]) {
    this.end = end;
    for (const s of sources) try { s.stop(end + 0.02); } catch { /* noop */ }
    if (sources[0]) sources[0].onended = () => { for (const n of this.nodes) try { n.disconnect(); } catch { /* noop */ } };
  }
  release(_t: number) { return this.end; }
  private killed = false;
  kill(time: number) {
    const t = Math.max(time, this.ctx.currentTime);
    if (this.killed || t >= this.end) return; // already silent: nothing to do
    this.killed = true;
    // explicit start value + short linear ramp (click-free, implementation-independent)
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + 0.03);
    this.end = Math.min(this.end, t + 0.04);
  }
}

export class DrumKitEngine implements InstrumentEngine {
  readonly output: GainNode;
  private spec: Instrument;
  private voices = new Set<Voice>();
  private openHat: OneShot | null = null;
  private shaper: WaveShaperNode;
  private pre: GainNode;
  constructor(private ctx: BaseAudioContext, spec: Instrument, private assets: AssetResolver) {
    this.spec = spec;
    this.output = ctx.createGain();
    this.pre = ctx.createGain();
    this.pre.gain.value = dbToGain(spec.params.gain + 6);
    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 1.1) / Math.tanh(1.1);
    }
    this.shaper.curve = curve;
    // kit bus: level -> gentle soft clip (glue) -> output
    this.pre.connect(this.shaper).connect(this.output);
  }
  update(spec: Instrument) {
    this.spec = spec;
    this.pre.gain.value = dbToGain(spec.params.gain + 6);
  }
  activeVoices() { return [...this.voices].filter((v) => v.end > this.ctx.currentTime).length; }
  stopAll(time: number) {
    for (const v of this.voices) v.kill(time);
    this.voices.clear();
  }
  dispose() {
    this.stopAll(this.ctx.currentTime);
    try { this.output.disconnect(); } catch { /* noop */ }
  }
  playNote(time: number, pitch: number, velocity: number) { this.noteOn(time, pitch, velocity); }

  noteOn(time: number, pitch: number, velocity: number): Voice | null {
    for (const v of this.voices) if (v.end < time - 0.1) this.voices.delete(v);
    const piece = this.spec.pieces[String(pitch)] ?? { tune: 0, decay: 1, level: 1, pan: 0, sampleAssetId: null };
    const kit = KITS[this.spec.kit] ?? KITS.electronic;
    const ctx = this.ctx;
    const out = ctx.createGain();
    const vel = Math.max(0.02, Math.min(1, velocity));
    out.gain.value = piece.level * kit.level * (0.2 + 0.8 * Math.pow(vel, 1.3));
    const pan = ctx.createStereoPanner();
    pan.pan.value = piece.pan;
    out.connect(pan).connect(this.pre);
    const nodes: AudioNode[] = [out, pan];
    const sources: AudioScheduledSourceNode[] = [];
    const tune = Math.pow(2, piece.tune / 12);
    const dec = piece.decay;
    let end = time + 0.5;

    // choke group: closed/pedal hat chokes an open hat
    if ((pitch === 42 || pitch === 44) && this.openHat) {
      this.openHat.kill(time);
      this.openHat = null;
    }

    const sample = piece.sampleAssetId ? this.assets.get(piece.sampleAssetId) : undefined;
    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample;
      src.playbackRate.value = tune;
      const env = ctx.createGain();
      src.connect(env).connect(out);
      const len = (sample.duration / tune) * Math.min(1, dec);
      env.gain.setValueAtTime(1, time);
      if (dec < 1) env.gain.setTargetAtTime(0, time + len * 0.7, len * 0.1);
      src.start(time);
      sources.push(src);
      nodes.push(src, env);
      end = time + sample.duration / tune;
    } else {
      end = this.synthPiece(pitch, time, vel, tune, dec, kit, out, sources, nodes);
    }
    const v = new OneShot(pitch, ctx, out, sources, end, nodes);
    if (pitch === 46) this.openHat = v;
    this.voices.add(v);
    return v;
  }

  private tone(type: OscillatorType, f0: number, f1: number, drop: number, t: number, peak: number, decay: number, dest: AudioNode, sources: AudioScheduledSourceNode[], nodes: AudioNode[]) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + drop);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.004, decay / 4);
    o.connect(g).connect(dest);
    o.start(t);
    sources.push(o);
    nodes.push(o, g);
    return t + decay * 1.4 + 0.02;
  }

  private noise(t: number, peak: number, decay: number, filterType: BiquadFilterType, freq: number, q: number, dest: AudioNode, sources: AudioScheduledSourceNode[], nodes: AudioNode[], attack = 0.001) {
    const ctx = this.ctx;
    const n = noiseSource(ctx);
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = Math.min(ctx.sampleRate / 2 - 200, freq);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0, t + attack + 0.001, decay / 4);
    n.connect(f).connect(g).connect(dest);
    n.start(t, (t * 7.31) % 1.5);
    sources.push(n);
    nodes.push(n, f, g);
    return t + attack + decay * 1.4 + 0.02;
  }

  private metal(t: number, base: number, peak: number, decay: number, hp: number, dest: AudioNode, sources: AudioScheduledSourceNode[], nodes: AudioNode[], attack = 0.001) {
    const ctx = this.ctx;
    const mix = ctx.createGain();
    mix.gain.value = 1 / METAL_RATIOS.length;
    const bp = ctx.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = Math.min(ctx.sampleRate / 2 - 200, hp);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0, t + attack + 0.001, decay / 4);
    mix.connect(bp).connect(g).connect(dest);
    nodes.push(mix, bp, g);
    for (const r of METAL_RATIOS) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = base * r;
      o.connect(mix);
      o.start(t);
      sources.push(o);
      nodes.push(o);
    }
    return t + attack + decay * 1.4 + 0.02;
  }

  private synthPiece(pitch: number, t: number, vel: number, tune: number, dec: number, k: KitCharacter, out: GainNode, sources: AudioScheduledSourceNode[], nodes: AudioNode[]): number {
    const b = k.brightness;
    let end = t;
    const E = (x: number) => (end = Math.max(end, x));
    switch (pitch) {
      case 36: { // kick
        const f = k.kickFreq * tune;
        E(this.tone('sine', f * k.kickDrop, f, 0.06, t, 1, k.kickDecay * dec, out, sources, nodes));
        E(this.tone('triangle', f * k.kickDrop * 2, f * 1.5, 0.03, t, 0.25 + k.kickDrive * 0.3, 0.06, out, sources, nodes));
        if (k.kickClick > 0) E(this.noise(t, 0.25 * k.kickClick * vel, 0.012, 'highpass', 3000 * b, 0.7, out, sources, nodes));
        break;
      }
      case 35: { // taiko / orchestral bass drum
        const f = 62 * tune;
        E(this.tone('sine', f * 1.8, f, 0.08, t, 1, 1.3 * dec, out, sources, nodes));
        E(this.tone('sine', f * 2.6, f * 1.6, 0.1, t, 0.35, 0.6 * dec, out, sources, nodes));
        E(this.noise(t, 0.4 * vel, 0.25 * dec, 'lowpass', 900, 0.8, out, sources, nodes));
        E(this.noise(t, 0.18, 0.02, 'bandpass', 2500, 1, out, sources, nodes));
        break;
      }
      case 38: case 40: { // snare / snap snare
        const snap = pitch === 40;
        E(this.tone('triangle', k.snareTone * tune * 1.6, k.snareTone * tune, 0.03, t, snap ? 0.25 : 0.55, 0.09 * dec, out, sources, nodes));
        E(this.tone('sine', k.snareTone * tune * 2.2, k.snareTone * tune * 1.4, 0.02, t, 0.2, 0.05 * dec, out, sources, nodes));
        E(this.noise(t, 0.85 * k.snareNoise, (snap ? 0.11 : k.snareDecay) * dec, 'highpass', (snap ? 2500 : k.snareHp) * b, 0.7, out, sources, nodes));
        E(this.noise(t, 0.35 * k.snareNoise, 0.08 * dec, 'bandpass', 5000 * b, 0.8, out, sources, nodes));
        break;
      }
      case 37: { // rim
        E(this.tone('triangle', 1750 * tune, 1600 * tune, 0.01, t, 0.6, 0.03 * dec, out, sources, nodes));
        E(this.noise(t, 0.4, 0.015, 'bandpass', 3500, 2, out, sources, nodes));
        break;
      }
      case 39: { // clap: three quick bursts + tail
        for (let i = 0; i < 3; i++) E(this.noise(t + i * k.clapSpread, 0.75, 0.012, 'bandpass', 1300 * tune * b, 1.4, out, sources, nodes));
        E(this.noise(t + 3 * k.clapSpread, 0.7, 0.18 * dec, 'bandpass', 1200 * tune * b, 1.1, out, sources, nodes));
        break;
      }
      case 42: case 44: { // closed / pedal hat
        const d = (pitch === 44 ? 0.04 : k.hatDecay) * dec;
        if (k.metallic > 0) E(this.metal(t, 320 * tune, 0.6 * k.metallic, d, k.hatFreq * b, out, sources, nodes));
        E(this.noise(t, 0.5 * (1.2 - k.metallic * 0.5), d, 'highpass', k.hatFreq * b, 0.8, out, sources, nodes));
        break;
      }
      case 46: { // open hat
        const d = k.hatDecay * 6 * dec;
        if (k.metallic > 0) E(this.metal(t, 320 * tune, 0.55 * k.metallic, d, k.hatFreq * 0.95 * b, out, sources, nodes));
        E(this.noise(t, 0.32, d, 'highpass', k.hatFreq * 0.9 * b, 0.8, out, sources, nodes));
        break;
      }
      case 41: case 45: case 48: case 43: case 47: case 50: { // toms
        const mult = pitch <= 43 ? 1 : pitch <= 47 ? 1.33 : 1.75;
        const f = k.tomBase * mult * tune;
        E(this.tone('sine', f * 1.6, f, 0.08, t, 0.9, 0.45 * dec, out, sources, nodes));
        E(this.noise(t, 0.15, 0.06, 'bandpass', f * 6, 1, out, sources, nodes));
        break;
      }
      case 49: case 57: case 55: { // crash / gong
        if (pitch === 57) {
          const f = 80 * tune;
          E(this.tone('sine', f, f * 0.98, 2, t, 0.6, 5 * dec, out, sources, nodes));
          E(this.metal(t, 110 * tune, 0.3, 4 * dec, 300, out, sources, nodes, 0.05));
          E(this.noise(t, 0.12, 3 * dec, 'bandpass', 1200, 0.5, out, sources, nodes, 0.08));
        } else {
          E(this.metal(t, 340 * tune, 0.3, k.cymbalDecay * dec, 4000 * b, out, sources, nodes));
          E(this.noise(t, 0.35, k.cymbalDecay * dec, 'highpass', 5000 * b, 0.6, out, sources, nodes));
        }
        break;
      }
      case 51: case 59: case 53: { // ride
        E(this.metal(t, 420 * tune, 0.4, 1.2 * dec, 5000 * b, out, sources, nodes));
        E(this.tone('sine', 2800 * tune, 2790 * tune, 0.1, t, 0.12, 0.7 * dec, out, sources, nodes));
        E(this.noise(t, 0.18, 0.9 * dec, 'highpass', 7000 * b, 0.6, out, sources, nodes));
        break;
      }
      case 52: { // cymbal swell (reverse-envelope roll)
        const len = 2 * dec;
        E(this.metal(t, 330 * tune, 0.3, 0.6, 3000, out, sources, nodes, len));
        E(this.noise(t, 0.5, 0.5, 'highpass', 4000, 0.6, out, sources, nodes, len));
        break;
      }
      case 54: { // tambourine
        for (let i = 0; i < 2; i++) E(this.noise(t + i * 0.008, 0.45, 0.06 * dec, 'highpass', 7000 * b, 1.2, out, sources, nodes));
        E(this.metal(t, 1400 * tune, 0.15, 0.12 * dec, 6000, out, sources, nodes));
        break;
      }
      case 56: { // cowbell
        const ctx = this.ctx;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 800 * tune;
        bp.Q.value = 2;
        bp.connect(out);
        nodes.push(bp);
        E(this.tone('square', 540 * tune, 540 * tune, 0.01, t, 0.5, 0.3 * dec, bp, sources, nodes));
        E(this.tone('square', 800 * tune, 800 * tune, 0.01, t, 0.5, 0.3 * dec, bp, sources, nodes));
        break;
      }
      case 70: case 69: { // shaker
        E(this.noise(t, 0.4, 0.05 * dec, 'bandpass', 6500 * b, 1.5, out, sources, nodes, 0.012));
        break;
      }
      case 75: case 76: case 77: { // clave / woodblock
        E(this.tone('sine', 2500 * tune, 2400 * tune, 0.01, t, 0.7, 0.05 * dec, out, sources, nodes));
        break;
      }
      default: { // generic pitched percussion: map pitch to frequency
        const f = 440 * Math.pow(2, (pitch - 69) / 12) * tune;
        E(this.tone('sine', f * 1.5, f, 0.03, t, 0.6, 0.25 * dec, out, sources, nodes));
        E(this.noise(t, 0.15, 0.03, 'bandpass', f * 3, 1, out, sources, nodes));
      }
    }
    return end;
  }
}
