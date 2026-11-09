/**
 * Instrument preset library. Every preset here is SYNTHESIZED in the browser
 * (source: 'synth'). Names describe the target character, and the UI labels them
 * as synthesized approximations — they are not recordings of real instruments.
 * Sampled instruments are created by the user importing their own samples.
 */
import { PRESET_TRIM } from './presetTrim';
import type { DrumKitName, DrumPiece, Instrument, InstrumentKind, SynthParams } from './schema';

export const DEFAULT_SYNTH: SynthParams = {
  osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: 0, level: 0.8 },
  osc2: { wave: 'sawtooth', octave: 0, semi: 0, detune: 7, level: 0 },
  subLevel: 0,
  noiseLevel: 0,
  unison: 1,
  unisonSpread: 12,
  filter: { type: 'lowpass', cutoff: 6000, resonance: 0.8, envAmount: 0, keyTrack: 0.3 },
  ampEnv: { attack: 0.005, decay: 0.2, sustain: 0.8, release: 0.25 },
  filterEnv: { attack: 0.005, decay: 0.3, sustain: 0.5, release: 0.3 },
  vibrato: { rate: 5, depth: 0, delay: 0.3 },
  lfo: { rate: 2, toCutoff: 0, toAmp: 0, wave: 'sine' },
  fm: { ratio: 2, index: 2, indexDecay: 0.6, modWave: 'sine' },
  drawbars: [8, 8, 8, 0, 0, 0, 0, 0, 0],
  pluck: { damping: 0.5, brightness: 0.6, body: 0.4 },
  glide: 0,
  gain: -6,
  transpose: 0,
  fine: 0,
  velocitySens: 0.7,
  expression: 1,
  pan: 0,
  maxVoices: 32,
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export function mergeParams(base: SynthParams, over: DeepPartial<SynthParams>): SynthParams {
  const out: any = structuredClone(base);
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = { ...out[k], ...v };
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

export interface PresetDef {
  id: string;
  name: string;
  category: 'Keys' | 'Bass' | 'Lead' | 'Pad' | 'Pluck' | 'Strings' | 'Brass' | 'Woodwinds' | 'Mallets & Bells' | 'Organ' | 'Guitar' | 'Choir' | 'FX' | 'Drums' | 'Percussion';
  kind: InstrumentKind;
  /** Short description including the honest note that this is synthesized. */
  description: string;
  params: DeepPartial<SynthParams>;
  kit?: DrumKitName;
  /** Recommended pitch range for composition [low, high] */
  range: [number, number];
}

const env = (attack: number, decay: number, sustain: number, release: number) => ({ attack, decay, sustain, release });

export const PRESETS: PresetDef[] = [
  // ---------- Keys ----------
  { id: 'synth-piano', name: 'Synth Grand (approx.)', category: 'Keys', kind: 'fm', range: [36, 96],
    description: 'Hammer-like FM tone with natural decay. A synthesized approximation of piano, not a sampled grand.',
    params: { fm: { ratio: 1, index: 1.6, indexDecay: 0.35, modWave: 'sine' }, osc1: { wave: 'triangle', octave: 0, semi: 0, detune: 0, level: 0.9 }, ampEnv: env(0.002, 2.6, 0, 0.35), filter: { type: 'lowpass', cutoff: 7000, resonance: 0.5, envAmount: 1.5, keyTrack: 0.6 }, filterEnv: env(0.001, 1.2, 0.1, 0.4), gain: -5, velocitySens: 0.85 } },
  { id: 'epiano', name: 'Electric Piano (FM)', category: 'Keys', kind: 'fm', range: [40, 88],
    description: 'Classic FM tine electric piano character, synthesized.',
    params: { fm: { ratio: 14, index: 0.9, indexDecay: 0.18, modWave: 'sine' }, osc1: { wave: 'sine', octave: 0, semi: 0, detune: 0, level: 1 }, ampEnv: env(0.002, 1.8, 0.15, 0.4), gain: -4, filter: { type: 'lowpass', cutoff: 9000, resonance: 0.5, envAmount: 0, keyTrack: 0 }, lfo: { rate: 4.5, toCutoff: 0, toAmp: 0.12, wave: 'sine' } } },
  { id: 'warm-epiano', name: 'Warm Keys (FM)', category: 'Keys', kind: 'fm', range: [40, 88],
    description: 'Mellow, lo-fi friendly electric piano, synthesized.',
    params: { fm: { ratio: 1, index: 0.8, indexDecay: 0.5, modWave: 'sine' }, osc1: { wave: 'sine', octave: 0, semi: 0, detune: 0, level: 1 }, ampEnv: env(0.004, 1.4, 0.3, 0.5), gain: -3, lfo: { rate: 3.5, toCutoff: 0, toAmp: 0.15, wave: 'sine' } } },
  { id: 'clav', name: 'Funky Clav', category: 'Keys', kind: 'subtractive', range: [40, 84],
    description: 'Bright percussive pulse keyboard, synthesized.',
    params: { osc1: { wave: 'square', octave: 0, semi: 0, detune: 0, level: 0.7 }, osc2: { wave: 'sawtooth', octave: 1, semi: 0, detune: 3, level: 0.3 }, filter: { type: 'bandpass', cutoff: 1800, resonance: 3, envAmount: 2, keyTrack: 0.5 }, ampEnv: env(0.001, 0.25, 0.2, 0.08), filterEnv: env(0.001, 0.15, 0.1, 0.1), gain: -8 } },
  // ---------- Organ ----------
  { id: 'organ-full', name: 'Drawbar Organ', category: 'Organ', kind: 'organ', range: [36, 88],
    description: 'Additive drawbar organ, synthesized.',
    params: { drawbars: [8, 8, 8, 4, 0, 0, 2, 0, 0], ampEnv: env(0.008, 0.1, 1, 0.08), gain: -12, lfo: { rate: 6.2, toCutoff: 0, toAmp: 0.06, wave: 'sine' } } },
  { id: 'organ-soft', name: 'Soft Church Organ', category: 'Organ', kind: 'organ', range: [36, 88],
    description: 'Gentle flute-stop organ, synthesized.',
    params: { drawbars: [6, 8, 4, 0, 2, 0, 0, 0, 0], ampEnv: env(0.08, 0.2, 1, 0.5), gain: -12 } },
  // ---------- Bass ----------
  { id: 'synth-bass', name: 'Analog Bass', category: 'Bass', kind: 'subtractive', range: [28, 55],
    description: 'Round analog-style bass with filter punch.',
    params: { osc1: { wave: 'sawtooth', octave: -1, semi: 0, detune: 0, level: 0.7 }, osc2: { wave: 'square', octave: -1, semi: 0, detune: -6, level: 0.4 }, subLevel: 0.5, filter: { type: 'lowpass', cutoff: 380, resonance: 2, envAmount: 2.6, keyTrack: 0.4 }, ampEnv: env(0.003, 0.3, 0.75, 0.12), filterEnv: env(0.002, 0.22, 0.2, 0.15), gain: -5, maxVoices: 4 } },
  { id: 'sub-bass', name: 'Sub Bass', category: 'Bass', kind: 'subtractive', range: [24, 50],
    description: 'Pure low sine sub for modern productions.',
    params: { osc1: { wave: 'sine', octave: -1, semi: 0, detune: 0, level: 1 }, osc2: { wave: 'triangle', octave: -1, semi: 0, detune: 0, level: 0.15 }, filter: { type: 'lowpass', cutoff: 900, resonance: 0.5, envAmount: 0, keyTrack: 0 }, ampEnv: env(0.005, 0.2, 0.95, 0.12), gain: -2, maxVoices: 2 } },
  { id: '808-bass', name: '808 Glide Bass', category: 'Bass', kind: 'subtractive', range: [24, 50],
    description: 'Long boomy 808-style bass with glide and soft saturation.',
    params: { osc1: { wave: 'sine', octave: -1, semi: 0, detune: 0, level: 1 }, osc2: { wave: 'triangle', octave: 0, semi: 0, detune: 0, level: 0.18 }, filter: { type: 'lowpass', cutoff: 1200, resonance: 0.5, envAmount: 0, keyTrack: 0 }, ampEnv: env(0.002, 1.6, 0.4, 0.3), glide: 0.06, gain: -2, maxVoices: 1 } },
  { id: 'reese-bass', name: 'Reese Bass', category: 'Bass', kind: 'subtractive', range: [26, 52],
    description: 'Detuned, moving bass for DnB/dubstep.',
    params: { osc1: { wave: 'sawtooth', octave: -1, semi: 0, detune: -18, level: 0.7 }, osc2: { wave: 'sawtooth', octave: -1, semi: 0, detune: 18, level: 0.7 }, subLevel: 0.4, filter: { type: 'lowpass', cutoff: 700, resonance: 2.5, envAmount: 0.5, keyTrack: 0.2 }, lfo: { rate: 0.4, toCutoff: 0.8, toAmp: 0, wave: 'triangle' }, ampEnv: env(0.01, 0.2, 0.9, 0.2), gain: -9, maxVoices: 2 } },
  { id: 'pick-bass', name: 'Picked Bass (approx.)', category: 'Bass', kind: 'pluck', range: [28, 55],
    description: 'Physically-modelled (Karplus-Strong) string bass approximation.',
    params: { pluck: { damping: 0.35, brightness: 0.45, body: 0.8 }, ampEnv: env(0.001, 2, 0.6, 0.12), gain: -1, filter: { type: 'lowpass', cutoff: 2500, resonance: 0.7, envAmount: 0, keyTrack: 0 } } },
  { id: 'orch-basses', name: 'Contrabass Section (synth)', category: 'Strings', kind: 'subtractive', range: [28, 55],
    description: 'Synthesized low string section for orchestral bass lines.',
    params: { osc1: { wave: 'sawtooth', octave: -1, semi: 0, detune: -5, level: 0.7 }, osc2: { wave: 'sawtooth', octave: -1, semi: 0, detune: 6, level: 0.6 }, unison: 2, unisonSpread: 10, filter: { type: 'lowpass', cutoff: 900, resonance: 0.6, envAmount: 0.8, keyTrack: 0.4 }, ampEnv: env(0.12, 0.3, 0.9, 0.5), filterEnv: env(0.2, 0.5, 0.6, 0.5), vibrato: { rate: 5, depth: 8, delay: 0.4 }, gain: -8 } },
  // ---------- Leads ----------
  { id: 'saw-lead', name: 'Saw Lead', category: 'Lead', kind: 'subtractive', range: [60, 96],
    description: 'Bright detuned saw lead.',
    params: { osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: -8, level: 0.6 }, osc2: { wave: 'sawtooth', octave: 0, semi: 0, detune: 8, level: 0.6 }, filter: { type: 'lowpass', cutoff: 4200, resonance: 1.4, envAmount: 1.2, keyTrack: 0.5 }, ampEnv: env(0.005, 0.2, 0.85, 0.2), vibrato: { rate: 5.5, depth: 14, delay: 0.35 }, glide: 0.03, gain: -12 } },
  { id: 'square-lead', name: 'Square Lead', category: 'Lead', kind: 'subtractive', range: [60, 96],
    description: 'Hollow retro square lead.',
    params: { osc1: { wave: 'square', octave: 0, semi: 0, detune: 0, level: 0.7 }, osc2: { wave: 'square', octave: 1, semi: 0, detune: 4, level: 0.15 }, filter: { type: 'lowpass', cutoff: 3200, resonance: 1, envAmount: 0.6, keyTrack: 0.5 }, ampEnv: env(0.004, 0.1, 0.9, 0.15), vibrato: { rate: 5.5, depth: 10, delay: 0.3 }, gain: -13 } },
  { id: 'supersaw', name: 'Supersaw', category: 'Lead', kind: 'subtractive', range: [55, 96],
    description: 'Wide unison supersaw for trance/EDM.',
    params: { osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: 0, level: 0.7 }, osc2: { wave: 'sawtooth', octave: 1, semi: 0, detune: 5, level: 0.25 }, unison: 5, unisonSpread: 28, filter: { type: 'lowpass', cutoff: 6500, resonance: 0.8, envAmount: 0.5, keyTrack: 0.3 }, ampEnv: env(0.01, 0.3, 0.85, 0.3), gain: -16 } },
  { id: 'sine-lead', name: 'Soft Sine Lead', category: 'Lead', kind: 'subtractive', range: [60, 96],
    description: 'Smooth whistle-like lead.',
    params: { osc1: { wave: 'sine', octave: 0, semi: 0, detune: 0, level: 0.9 }, osc2: { wave: 'triangle', octave: 1, semi: 0, detune: 0, level: 0.12 }, filter: { type: 'lowpass', cutoff: 8000, resonance: 0.5, envAmount: 0, keyTrack: 0 }, ampEnv: env(0.03, 0.2, 0.9, 0.3), vibrato: { rate: 5, depth: 18, delay: 0.25 }, glide: 0.04, gain: -8 } },
  { id: 'vocal-guide', name: 'Vocal Guide Synth', category: 'Choir', kind: 'subtractive', range: [48, 81],
    description: 'Formant-filtered guide tone for vocal melodies. This is NOT singing — it marks the melody a singer (or a vocal provider) should perform.',
    params: { osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: 0, level: 0.6 }, osc2: { wave: 'triangle', octave: 0, semi: 0, detune: 3, level: 0.5 }, filter: { type: 'bandpass', cutoff: 1100, resonance: 2.2, envAmount: 0.3, keyTrack: 0.6 }, ampEnv: env(0.05, 0.2, 0.85, 0.2), vibrato: { rate: 5.2, depth: 22, delay: 0.3 }, glide: 0.05, gain: -4 } },
  // ---------- Pads ----------
  { id: 'warm-pad', name: 'Warm Pad', category: 'Pad', kind: 'subtractive', range: [48, 84],
    description: 'Slow lush analog pad.',
    params: { osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: -10, level: 0.5 }, osc2: { wave: 'sawtooth', octave: 0, semi: 0, detune: 10, level: 0.5 }, unison: 3, unisonSpread: 16, filter: { type: 'lowpass', cutoff: 1600, resonance: 0.7, envAmount: 0.6, keyTrack: 0.3 }, ampEnv: env(0.9, 1, 0.85, 1.8), filterEnv: env(1.2, 1.5, 0.6, 1.5), lfo: { rate: 0.3, toCutoff: 0.4, toAmp: 0, wave: 'sine' }, gain: -15 } },
  { id: 'glass-pad', name: 'Glass Pad', category: 'Pad', kind: 'fm', range: [48, 88],
    description: 'Shimmering FM pad.',
    params: { fm: { ratio: 3, index: 1.4, indexDecay: 3, modWave: 'sine' }, osc1: { wave: 'sine', octave: 0, semi: 0, detune: 0, level: 1 }, ampEnv: env(0.7, 1.2, 0.8, 2.2), lfo: { rate: 0.25, toCutoff: 0, toAmp: 0.1, wave: 'sine' }, gain: -12 } },
  { id: 'dark-pad', name: 'Dark Atmosphere', category: 'Pad', kind: 'subtractive', range: [36, 72],
    description: 'Brooding, filtered, noisy texture.',
    params: { osc1: { wave: 'sawtooth', octave: -1, semi: 0, detune: -6, level: 0.5 }, osc2: { wave: 'square', octave: 0, semi: 7, detune: 6, level: 0.25 }, noiseLevel: 0.06, unison: 2, filter: { type: 'lowpass', cutoff: 700, resonance: 1.5, envAmount: 0.8, keyTrack: 0.2 }, ampEnv: env(1.6, 1, 0.9, 2.5), filterEnv: env(2, 2, 0.5, 2), lfo: { rate: 0.12, toCutoff: 1, toAmp: 0, wave: 'triangle' }, gain: -14 } },
  { id: 'synth-choir', name: 'Synth Choir "Aah" (approx.)', category: 'Choir', kind: 'subtractive', range: [48, 79],
    description: 'Formant pad approximating a choir texture. Synthesized; contains no real voices or words.',
    params: { osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: -6, level: 0.5 }, osc2: { wave: 'sawtooth', octave: 0, semi: 0, detune: 7, level: 0.5 }, unison: 3, unisonSpread: 14, filter: { type: 'bandpass', cutoff: 900, resonance: 1.6, envAmount: 0.2, keyTrack: 0.7 }, ampEnv: env(0.5, 0.5, 0.9, 1.2), vibrato: { rate: 4.8, depth: 12, delay: 0.5 }, gain: -10 } },
  // ---------- Plucks / guitars ----------
  { id: 'pluck', name: 'Synth Pluck', category: 'Pluck', kind: 'subtractive', range: [52, 91],
    description: 'Short bright filtered pluck.',
    params: { osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: -4, level: 0.6 }, osc2: { wave: 'square', octave: 0, semi: 0, detune: 4, level: 0.4 }, filter: { type: 'lowpass', cutoff: 600, resonance: 2, envAmount: 4, keyTrack: 0.5 }, ampEnv: env(0.001, 0.4, 0, 0.25), filterEnv: env(0.001, 0.18, 0, 0.2), gain: -9 } },
  { id: 'arp-pluck', name: 'Arp Pluck', category: 'Pluck', kind: 'subtractive', range: [55, 91],
    description: 'Tight, resonant arpeggio pluck.',
    params: { osc1: { wave: 'square', octave: 0, semi: 0, detune: 0, level: 0.6 }, osc2: { wave: 'sawtooth', octave: 1, semi: 0, detune: 6, level: 0.3 }, filter: { type: 'lowpass', cutoff: 900, resonance: 4, envAmount: 3.2, keyTrack: 0.6 }, ampEnv: env(0.001, 0.22, 0.05, 0.15), filterEnv: env(0.001, 0.12, 0, 0.1), gain: -12 } },
  { id: 'nylon-guitar', name: 'Nylon Guitar (modelled)', category: 'Guitar', kind: 'pluck', range: [40, 81],
    description: 'Karplus-Strong plucked string model. Guitar-like, not a recorded guitar.',
    params: { pluck: { damping: 0.45, brightness: 0.5, body: 0.6 }, ampEnv: env(0.001, 3, 0.5, 0.25), gain: -2 } },
  { id: 'steel-guitar', name: 'Steel Guitar (modelled)', category: 'Guitar', kind: 'pluck', range: [40, 84],
    description: 'Brighter plucked string model for strummed/arpeggiated parts.',
    params: { pluck: { damping: 0.25, brightness: 0.8, body: 0.4 }, ampEnv: env(0.001, 3, 0.6, 0.3), gain: -3 } },
  { id: 'dist-guitar', name: 'Overdrive Guitar (synth)', category: 'Guitar', kind: 'pluck', range: [40, 76],
    description: 'Plucked-string model intended to be driven by the track distortion effect. A synthesized stand-in for an electric guitar.',
    params: { pluck: { damping: 0.15, brightness: 0.85, body: 0.3 }, ampEnv: env(0.001, 4, 0.85, 0.12), gain: -4 } },
  { id: 'harp', name: 'Harp (modelled)', category: 'Pluck', kind: 'pluck', range: [36, 96],
    description: 'Soft plucked string model for harp-like arpeggios.',
    params: { pluck: { damping: 0.55, brightness: 0.45, body: 0.5 }, ampEnv: env(0.001, 4, 0.4, 1), gain: -3 } },
  // ---------- Strings ----------
  { id: 'string-ensemble', name: 'String Ensemble (synth)', category: 'Strings', kind: 'subtractive', range: [48, 88],
    description: 'Synthesized string section — lush, but not a sampled orchestra.',
    params: { osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: -9, level: 0.5 }, osc2: { wave: 'sawtooth', octave: 0, semi: 0, detune: 9, level: 0.5 }, unison: 3, unisonSpread: 14, filter: { type: 'lowpass', cutoff: 2600, resonance: 0.6, envAmount: 0.8, keyTrack: 0.5 }, ampEnv: env(0.25, 0.4, 0.9, 0.7), filterEnv: env(0.3, 0.6, 0.7, 0.6), vibrato: { rate: 5.2, depth: 10, delay: 0.35 }, gain: -14 } },
  { id: 'violins', name: 'Violins (synth)', category: 'Strings', kind: 'subtractive', range: [55, 100],
    description: 'Bright synthesized high strings with expressive vibrato.',
    params: { osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: -6, level: 0.55 }, osc2: { wave: 'sawtooth', octave: 0, semi: 0, detune: 7, level: 0.5 }, unison: 2, unisonSpread: 10, filter: { type: 'lowpass', cutoff: 3800, resonance: 0.8, envAmount: 0.6, keyTrack: 0.6 }, ampEnv: env(0.12, 0.3, 0.9, 0.45), vibrato: { rate: 5.6, depth: 16, delay: 0.25 }, gain: -14 } },
  { id: 'cellos', name: 'Cellos (synth)', category: 'Strings', kind: 'subtractive', range: [36, 72],
    description: 'Warm synthesized low-mid strings.',
    params: { osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: -5, level: 0.6 }, osc2: { wave: 'sawtooth', octave: 0, semi: 0, detune: 5, level: 0.5 }, unison: 2, filter: { type: 'lowpass', cutoff: 1500, resonance: 0.7, envAmount: 0.7, keyTrack: 0.5 }, ampEnv: env(0.15, 0.3, 0.9, 0.5), vibrato: { rate: 5, depth: 12, delay: 0.3 }, gain: -12 } },
  { id: 'spiccato', name: 'Spiccato Strings (synth)', category: 'Strings', kind: 'subtractive', range: [43, 84],
    description: 'Short bowed-attack strings for cinematic ostinatos.',
    params: { osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: -7, level: 0.55 }, osc2: { wave: 'sawtooth', octave: 0, semi: 0, detune: 7, level: 0.5 }, unison: 2, filter: { type: 'lowpass', cutoff: 1400, resonance: 1, envAmount: 2, keyTrack: 0.5 }, ampEnv: env(0.006, 0.16, 0.15, 0.12), filterEnv: env(0.003, 0.1, 0.1, 0.1), gain: -10 } },
  { id: 'pizzicato', name: 'Pizzicato (modelled)', category: 'Strings', kind: 'pluck', range: [40, 88],
    description: 'Plucked string model for pizzicato figures.',
    params: { pluck: { damping: 0.75, brightness: 0.35, body: 0.7 }, ampEnv: env(0.001, 0.8, 0, 0.2), gain: -1 } },
  // ---------- Brass ----------
  { id: 'brass-section', name: 'Brass Section (synth)', category: 'Brass', kind: 'subtractive', range: [45, 80],
    description: 'Bold filter-swell brass, synthesized.',
    params: { osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: -5, level: 0.6 }, osc2: { wave: 'sawtooth', octave: 0, semi: 0, detune: 5, level: 0.55 }, unison: 2, unisonSpread: 8, filter: { type: 'lowpass', cutoff: 700, resonance: 1, envAmount: 2.4, keyTrack: 0.6 }, ampEnv: env(0.04, 0.3, 0.85, 0.25), filterEnv: env(0.06, 0.4, 0.55, 0.3), vibrato: { rate: 5, depth: 6, delay: 0.5 }, gain: -12 } },
  { id: 'french-horns', name: 'French Horns (synth)', category: 'Brass', kind: 'subtractive', range: [41, 77],
    description: 'Round, heroic horn-like tone, synthesized.',
    params: { osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: -4, level: 0.5 }, osc2: { wave: 'triangle', octave: 0, semi: 0, detune: 4, level: 0.6 }, unison: 2, filter: { type: 'lowpass', cutoff: 520, resonance: 0.8, envAmount: 1.6, keyTrack: 0.6 }, ampEnv: env(0.08, 0.4, 0.85, 0.4), filterEnv: env(0.12, 0.5, 0.6, 0.4), gain: -9 } },
  { id: 'trumpet', name: 'Trumpet (synth)', category: 'Brass', kind: 'subtractive', range: [55, 84],
    description: 'Bright solo brass lead, synthesized.',
    params: { osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: 0, level: 0.8 }, osc2: { wave: 'square', octave: 0, semi: 0, detune: 3, level: 0.2 }, filter: { type: 'lowpass', cutoff: 1100, resonance: 1.2, envAmount: 2.2, keyTrack: 0.7 }, ampEnv: env(0.03, 0.2, 0.85, 0.15), filterEnv: env(0.04, 0.25, 0.6, 0.2), vibrato: { rate: 5.5, depth: 12, delay: 0.4 }, gain: -12 } },
  { id: 'trombone', name: 'Trombones (synth)', category: 'Brass', kind: 'subtractive', range: [36, 70],
    description: 'Low brass, synthesized.',
    params: { osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: -3, level: 0.7 }, osc2: { wave: 'sawtooth', octave: 0, semi: 0, detune: 3, level: 0.5 }, filter: { type: 'lowpass', cutoff: 500, resonance: 1, envAmount: 2, keyTrack: 0.6 }, ampEnv: env(0.05, 0.3, 0.85, 0.25), filterEnv: env(0.06, 0.35, 0.5, 0.3), gain: -11 } },
  // ---------- Woodwinds ----------
  { id: 'flute', name: 'Flute (synth)', category: 'Woodwinds', kind: 'subtractive', range: [60, 96],
    description: 'Breathy sine/noise flute approximation.',
    params: { osc1: { wave: 'sine', octave: 0, semi: 0, detune: 0, level: 0.9 }, osc2: { wave: 'triangle', octave: 1, semi: 0, detune: 0, level: 0.1 }, noiseLevel: 0.05, filter: { type: 'lowpass', cutoff: 5000, resonance: 0.5, envAmount: 0, keyTrack: 0.2 }, ampEnv: env(0.06, 0.2, 0.85, 0.2), vibrato: { rate: 5, depth: 14, delay: 0.3 }, gain: -6 } },
  { id: 'clarinet', name: 'Clarinet (synth)', category: 'Woodwinds', kind: 'subtractive', range: [50, 88],
    description: 'Hollow square-wave reed approximation.',
    params: { osc1: { wave: 'square', octave: 0, semi: 0, detune: 0, level: 0.7 }, osc2: { wave: 'sine', octave: 0, semi: 0, detune: 0, level: 0.3 }, filter: { type: 'lowpass', cutoff: 2000, resonance: 0.8, envAmount: 0.4, keyTrack: 0.6 }, ampEnv: env(0.04, 0.2, 0.85, 0.15), vibrato: { rate: 4.8, depth: 6, delay: 0.5 }, gain: -10 } },
  { id: 'sax', name: 'Saxophone (synth)', category: 'Woodwinds', kind: 'subtractive', range: [49, 81],
    description: 'Reedy, growly saw approximation of a sax.',
    params: { osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: 0, level: 0.7 }, osc2: { wave: 'square', octave: 0, semi: 0, detune: 5, level: 0.3 }, noiseLevel: 0.03, filter: { type: 'bandpass', cutoff: 1400, resonance: 1.4, envAmount: 1.2, keyTrack: 0.6 }, ampEnv: env(0.03, 0.2, 0.85, 0.15), filterEnv: env(0.03, 0.3, 0.5, 0.2), vibrato: { rate: 5, depth: 16, delay: 0.35 }, gain: -8 } },
  // ---------- Mallets & bells ----------
  { id: 'bells', name: 'Bells (FM)', category: 'Mallets & Bells', kind: 'fm', range: [60, 100],
    description: 'Inharmonic FM bell.',
    params: { fm: { ratio: 3.5, index: 3, indexDecay: 1.2, modWave: 'sine' }, osc1: { wave: 'sine', octave: 0, semi: 0, detune: 0, level: 1 }, ampEnv: env(0.001, 2.8, 0, 2), gain: -10 } },
  { id: 'celesta', name: 'Celesta / Music Box (FM)', category: 'Mallets & Bells', kind: 'fm', range: [67, 103],
    description: 'Delicate FM glockenspiel/celesta.',
    params: { fm: { ratio: 5, index: 1.2, indexDecay: 0.3, modWave: 'sine' }, osc1: { wave: 'sine', octave: 0, semi: 0, detune: 0, level: 1 }, ampEnv: env(0.001, 1.4, 0, 0.8), gain: -8 } },
  { id: 'marimba', name: 'Marimba (FM)', category: 'Mallets & Bells', kind: 'fm', range: [48, 90],
    description: 'Woody FM mallet.',
    params: { fm: { ratio: 4, index: 2, indexDecay: 0.06, modWave: 'sine' }, osc1: { wave: 'sine', octave: 0, semi: 0, detune: 0, level: 1 }, ampEnv: env(0.001, 0.7, 0, 0.3), gain: -4 } },
  { id: 'timpani', name: 'Timpani (synth)', category: 'Percussion', kind: 'fm', range: [36, 55],
    description: 'Pitched kettle-drum approximation for orchestral rolls and hits.',
    params: { fm: { ratio: 1.5, index: 1.6, indexDecay: 0.12, modWave: 'sine' }, osc1: { wave: 'sine', octave: 0, semi: 0, detune: 0, level: 1 }, noiseLevel: 0.12, ampEnv: env(0.001, 1.8, 0, 1), gain: 0 } },
  // ---------- FX ----------
  { id: 'noise-riser', name: 'Noise Riser / Sweep', category: 'FX', kind: 'subtractive', range: [48, 84],
    description: 'Filtered noise sweep for transitions and build-ups.',
    params: { osc1: { wave: 'sawtooth', octave: 0, semi: 0, detune: 0, level: 0.05 }, osc2: { wave: 'sawtooth', octave: 0, semi: 0, detune: 0, level: 0 }, noiseLevel: 0.9, filter: { type: 'bandpass', cutoff: 300, resonance: 1.5, envAmount: 5, keyTrack: 0 }, ampEnv: env(3, 0.1, 1, 0.6), filterEnv: env(4, 0.1, 1, 0.5), gain: -12 } },
  { id: 'impact', name: 'Cinematic Impact', category: 'FX', kind: 'fm', range: [24, 48],
    description: 'Deep boom for downbeats and section hits.',
    params: { fm: { ratio: 0.5, index: 4, indexDecay: 0.08, modWave: 'sine' }, osc1: { wave: 'sine', octave: -1, semi: 0, detune: 0, level: 1 }, noiseLevel: 0.25, ampEnv: env(0.001, 2.5, 0, 1.5), gain: 0 } },
  { id: 'rain-ambience', name: 'Rain Ambience (noise texture)', category: 'FX', kind: 'subtractive', range: [60, 72],
    description: 'Synthesized rain-like noise bed (filtered noise with slow movement). A texture, not a field recording.',
    params: { osc1: { wave: 'sine', octave: 0, semi: 0, detune: 0, level: 0 }, osc2: { wave: 'sine', octave: 0, semi: 0, detune: 0, level: 0 }, noiseLevel: 1, filter: { type: 'bandpass', cutoff: 3200, resonance: 0.35, envAmount: 0, keyTrack: 0 }, ampEnv: env(2.5, 0.5, 1, 3), lfo: { rate: 0.17, toCutoff: 0.6, toAmp: 0.25, wave: 'triangle' }, gain: -16, maxVoices: 2 } },
  { id: 'drone', name: 'Atmospheric Drone', category: 'FX', kind: 'subtractive', range: [24, 60],
    description: 'Evolving low drone with noise.',
    params: { osc1: { wave: 'sawtooth', octave: -1, semi: 0, detune: -4, level: 0.4 }, osc2: { wave: 'sine', octave: 0, semi: 7, detune: 4, level: 0.4 }, noiseLevel: 0.08, filter: { type: 'lowpass', cutoff: 500, resonance: 2, envAmount: 0, keyTrack: 0 }, ampEnv: env(3, 1, 1, 4), lfo: { rate: 0.08, toCutoff: 1.4, toAmp: 0.1, wave: 'triangle' }, gain: -12 } },
  // ---------- Drums ----------
  { id: 'kit-electronic', name: 'Electronic Kit', category: 'Drums', kind: 'drumkit', kit: 'electronic', range: [35, 81], description: 'Synthesized electronic drum kit.', params: {} },
  { id: 'kit-808', name: '808-Style Kit', category: 'Drums', kind: 'drumkit', kit: '808', range: [35, 81], description: 'Synthesized drum-machine kit with booming kick.', params: {} },
  { id: 'kit-trap', name: 'Trap Kit', category: 'Drums', kind: 'drumkit', kit: 'trap', range: [35, 81], description: 'Synthesized trap kit: tight hats, snappy snare.', params: {} },
  { id: 'kit-acoustic', name: 'Studio Kit (synth)', category: 'Drums', kind: 'drumkit', kit: 'acoustic', range: [35, 81], description: 'Synthesized approximation of an acoustic kit. Load your own samples per piece for realism.', params: {} },
  { id: 'kit-rock', name: 'Rock Kit (synth)', category: 'Drums', kind: 'drumkit', kit: 'rock', range: [35, 81], description: 'Punchy synthesized rock kit.', params: {} },
  { id: 'kit-lofi', name: 'Lo-Fi Kit', category: 'Drums', kind: 'drumkit', kit: 'lofi', range: [35, 81], description: 'Dusty, soft synthesized kit.', params: {} },
  { id: 'kit-orchestral', name: 'Orchestral Percussion (synth)', category: 'Percussion', kind: 'drumkit', kit: 'orchestral', range: [35, 81], description: 'Synthesized taiko/bass drum, snare, cymbals and gongs for cinematic music.', params: {} },
];

export const PRESET_MAP: Record<string, PresetDef> = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

/** GM-style drum map used by drum tracks. */
export const DRUM_PIECES: { pitch: number; name: string; short: string }[] = [
  { pitch: 36, name: 'Kick', short: 'KICK' },
  { pitch: 38, name: 'Snare', short: 'SNR' },
  { pitch: 37, name: 'Rim / Side Stick', short: 'RIM' },
  { pitch: 39, name: 'Clap', short: 'CLAP' },
  { pitch: 42, name: 'Closed Hi-Hat', short: 'CHH' },
  { pitch: 44, name: 'Pedal Hi-Hat', short: 'PHH' },
  { pitch: 46, name: 'Open Hi-Hat', short: 'OHH' },
  { pitch: 41, name: 'Low Tom', short: 'TOM L' },
  { pitch: 45, name: 'Mid Tom', short: 'TOM M' },
  { pitch: 48, name: 'High Tom', short: 'TOM H' },
  { pitch: 49, name: 'Crash', short: 'CRSH' },
  { pitch: 51, name: 'Ride', short: 'RIDE' },
  { pitch: 54, name: 'Tambourine', short: 'TAMB' },
  { pitch: 56, name: 'Cowbell', short: 'BELL' },
  { pitch: 70, name: 'Shaker', short: 'SHKR' },
  { pitch: 75, name: 'Clave / Woodblock', short: 'CLAV' },
  { pitch: 35, name: 'Taiko / Big Drum', short: 'TAIKO' },
  { pitch: 52, name: 'Cymbal Swell', short: 'SWEL' },
  { pitch: 57, name: 'Gong / Tam-tam', short: 'GONG' },
  { pitch: 40, name: 'Snap / Electric Snare', short: 'SNAP' },
];
export const DRUM_NAME: Record<number, string> = Object.fromEntries(DRUM_PIECES.map((d) => [d.pitch, d.name]));

export function defaultDrumPieces(): Record<string, DrumPiece> {
  const out: Record<string, DrumPiece> = {};
  for (const d of DRUM_PIECES) out[String(d.pitch)] = { tune: 0, decay: 1, level: 1, pan: 0, sampleAssetId: null };
  // gentle default stereo placement
  out['42'].pan = 0.25; out['46'].pan = 0.25; out['44'].pan = 0.25;
  out['41'].pan = -0.3; out['45'].pan = 0; out['48'].pan = 0.3;
  out['49'].pan = -0.35; out['51'].pan = 0.35; out['70'].pan = -0.2; out['54'].pan = 0.2;
  return out;
}

export function instrumentFromPreset(presetId: string): Instrument {
  const p = PRESET_MAP[presetId] ?? PRESET_MAP['synth-piano'];
  return {
    kind: p.kind,
    preset: p.id,
    source: 'synth',
    params: (() => {
      const params = mergeParams(DEFAULT_SYNTH, p.params);
      params.gain = Math.max(-48, Math.min(12, params.gain + (PRESET_TRIM[p.id] ?? 0)));
      return params;
    })(),
    kit: p.kit ?? 'electronic',
    pieces: defaultDrumPieces(),
    zones: [],
  };
}

export function emptySamplerInstrument(): Instrument {
  return {
    kind: 'sampler',
    preset: 'sampler',
    source: 'sampled',
    params: mergeParams(DEFAULT_SYNTH, { ampEnv: env(0.002, 0.5, 1, 0.4), filter: { type: 'lowpass', cutoff: 20000, resonance: 0.5, envAmount: 0, keyTrack: 0 }, gain: 0 }),
    kit: 'electronic',
    pieces: defaultDrumPieces(),
    zones: [],
  };
}
