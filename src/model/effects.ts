/** Effect parameter definitions, defaults, and mixing/mastering presets (pure data). */
import type { Effect, EffectType } from './schema';
import { uid } from '../util/id';

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  unit?: string;
  step?: number;
  log?: boolean;
}
export interface ChoiceDef { key: string; label: string; options: string[]; default: string }
export interface EffectDef {
  type: EffectType;
  name: string;
  description: string;
  params: ParamDef[];
  choices?: ChoiceDef[];
  toggles?: { key: string; label: string; default: boolean }[];
}

export const EFFECT_DEFS: Record<EffectType, EffectDef> = {
  eq: {
    type: 'eq', name: 'Parametric EQ', description: 'High-pass + low shelf + two peaking bands + high shelf.',
    params: [
      { key: 'hpf', label: 'Low Cut', min: 20, max: 1000, default: 20, unit: 'Hz', log: true },
      { key: 'lowFreq', label: 'Low Freq', min: 40, max: 500, default: 120, unit: 'Hz', log: true },
      { key: 'lowGain', label: 'Low', min: -18, max: 18, default: 0, unit: 'dB', step: 0.1 },
      { key: 'mid1Freq', label: 'Mid 1 Freq', min: 100, max: 4000, default: 500, unit: 'Hz', log: true },
      { key: 'mid1Gain', label: 'Mid 1', min: -18, max: 18, default: 0, unit: 'dB', step: 0.1 },
      { key: 'mid1Q', label: 'Mid 1 Q', min: 0.2, max: 10, default: 1, step: 0.05 },
      { key: 'mid2Freq', label: 'Mid 2 Freq', min: 500, max: 12000, default: 3000, unit: 'Hz', log: true },
      { key: 'mid2Gain', label: 'Mid 2', min: -18, max: 18, default: 0, unit: 'dB', step: 0.1 },
      { key: 'mid2Q', label: 'Mid 2 Q', min: 0.2, max: 10, default: 1, step: 0.05 },
      { key: 'highFreq', label: 'High Freq', min: 2000, max: 18000, default: 8000, unit: 'Hz', log: true },
      { key: 'highGain', label: 'High', min: -18, max: 18, default: 0, unit: 'dB', step: 0.1 },
    ],
  },
  compressor: {
    type: 'compressor', name: 'Compressor', description: 'Dynamics compressor with make-up gain and dry/wet (parallel) mix.',
    params: [
      { key: 'threshold', label: 'Threshold', min: -60, max: 0, default: -18, unit: 'dB', step: 0.5 },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, default: 4, step: 0.1 },
      { key: 'attack', label: 'Attack', min: 0.0005, max: 0.3, default: 0.01, unit: 's', step: 0.0005 },
      { key: 'release', label: 'Release', min: 0.01, max: 1.5, default: 0.2, unit: 's', step: 0.01 },
      { key: 'knee', label: 'Knee', min: 0, max: 30, default: 6, unit: 'dB' },
      { key: 'makeup', label: 'Make-up', min: 0, max: 24, default: 3, unit: 'dB', step: 0.1 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 1, step: 0.01 },
    ],
  },
  limiter: {
    type: 'limiter', name: 'Limiter', description: 'Look-ahead brickwall peak limiter (AudioWorklet) with input gain and output ceiling.',
    params: [
      { key: 'gain', label: 'Input Gain', min: 0, max: 24, default: 0, unit: 'dB', step: 0.1 },
      { key: 'ceiling', label: 'Ceiling', min: -12, max: 0, default: -1, unit: 'dBFS', step: 0.1 },
      { key: 'release', label: 'Release', min: 0.01, max: 1, default: 0.12, unit: 's', step: 0.01 },
    ],
  },
  reverb: {
    type: 'reverb', name: 'Reverb', description: 'Stereo convolution reverb using a generated room/hall impulse response.',
    params: [
      { key: 'decay', label: 'Decay', min: 0.2, max: 12, default: 2.4, unit: 's', step: 0.1 },
      { key: 'predelay', label: 'Pre-delay', min: 0, max: 0.2, default: 0.02, unit: 's', step: 0.001 },
      { key: 'tone', label: 'Tone', min: 1000, max: 16000, default: 7000, unit: 'Hz', log: true },
      { key: 'size', label: 'Early Size', min: 0, max: 1, default: 0.5, step: 0.01 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.25, step: 0.01 },
    ],
  },
  delay: {
    type: 'delay', name: 'Delay', description: 'Tempo-synced stereo / ping-pong delay with filtered feedback.',
    params: [
      { key: 'time', label: 'Time', min: 0.0625, max: 4, default: 0.75, unit: 'beats', step: 0.0625 },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, default: 0.35, step: 0.01 },
      { key: 'tone', label: 'Tone', min: 500, max: 16000, default: 5000, unit: 'Hz', log: true },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.25, step: 0.01 },
    ],
    toggles: [{ key: 'pingpong', label: 'Ping-pong', default: true }],
  },
  chorus: {
    type: 'chorus', name: 'Chorus', description: 'Dual modulated-delay stereo chorus.',
    params: [
      { key: 'rate', label: 'Rate', min: 0.05, max: 8, default: 0.8, unit: 'Hz', step: 0.01 },
      { key: 'depth', label: 'Depth', min: 0, max: 0.01, default: 0.003, unit: 's', step: 0.0001 },
      { key: 'delay', label: 'Delay', min: 0.002, max: 0.04, default: 0.015, unit: 's', step: 0.0005 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.45, step: 0.01 },
    ],
  },
  flanger: {
    type: 'flanger', name: 'Flanger', description: 'Short modulated delay with feedback.',
    params: [
      { key: 'rate', label: 'Rate', min: 0.02, max: 5, default: 0.25, unit: 'Hz', step: 0.01 },
      { key: 'depth', label: 'Depth', min: 0, max: 0.005, default: 0.002, unit: 's', step: 0.0001 },
      { key: 'feedback', label: 'Feedback', min: -0.95, max: 0.95, default: 0.6, step: 0.01 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.5, step: 0.01 },
    ],
  },
  phaser: {
    type: 'phaser', name: 'Phaser', description: 'Six-stage all-pass phaser with LFO sweep.',
    params: [
      { key: 'rate', label: 'Rate', min: 0.02, max: 8, default: 0.4, unit: 'Hz', step: 0.01 },
      { key: 'base', label: 'Base Freq', min: 100, max: 4000, default: 700, unit: 'Hz', log: true },
      { key: 'depth', label: 'Depth', min: 0, max: 1, default: 0.7, step: 0.01 },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.9, default: 0.4, step: 0.01 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.5, step: 0.01 },
    ],
  },
  distortion: {
    type: 'distortion', name: 'Distortion', description: 'Oversampled waveshaper with pre-gain and tone control.',
    params: [
      { key: 'drive', label: 'Drive', min: 0, max: 1, default: 0.5, step: 0.01 },
      { key: 'tone', label: 'Tone', min: 500, max: 12000, default: 4000, unit: 'Hz', log: true },
      { key: 'output', label: 'Output', min: -24, max: 6, default: -6, unit: 'dB', step: 0.1 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 1, step: 0.01 },
    ],
    choices: [{ key: 'curve', label: 'Curve', options: ['soft', 'hard', 'fuzz', 'fold'], default: 'soft' }],
  },
  saturation: {
    type: 'saturation', name: 'Saturation', description: 'Gentle tanh tape/tube-style harmonic saturation.',
    params: [
      { key: 'drive', label: 'Drive', min: 0, max: 18, default: 4, unit: 'dB', step: 0.1 },
      { key: 'warmth', label: 'Warmth', min: 0, max: 1, default: 0.3, step: 0.01 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 1, step: 0.01 },
    ],
  },
  filter: {
    type: 'filter', name: 'Filter / Auto-filter', description: 'Resonant multimode filter with optional LFO sweep.',
    params: [
      { key: 'cutoff', label: 'Cutoff', min: 20, max: 20000, default: 2000, unit: 'Hz', log: true },
      { key: 'resonance', label: 'Resonance', min: 0.1, max: 20, default: 1, step: 0.1 },
      { key: 'lfoRate', label: 'LFO Rate', min: 0, max: 10, default: 0, unit: 'Hz', step: 0.01 },
      { key: 'lfoDepth', label: 'LFO Depth', min: 0, max: 4, default: 0, unit: 'oct', step: 0.01 },
    ],
    choices: [{ key: 'mode', label: 'Mode', options: ['lowpass', 'highpass', 'bandpass', 'notch'], default: 'lowpass' }],
  },
  width: {
    type: 'width', name: 'Stereo Width', description: 'Mid/side stereo width (0 = mono, 1 = unchanged, 2 = extra wide).',
    params: [
      { key: 'width', label: 'Width', min: 0, max: 2, default: 1.2, step: 0.01 },
      { key: 'monoBelow', label: 'Mono Bass Below', min: 0, max: 300, default: 0, unit: 'Hz' },
    ],
  },
  ducking: {
    type: 'ducking', name: 'Sidechain Ducking', description: 'Ducks this channel every time notes play on a trigger track (e.g. the kick) — sample-accurate, works in export.',
    params: [
      { key: 'depth', label: 'Depth', min: 0, max: 1, default: 0.6, step: 0.01 },
      { key: 'attack', label: 'Attack', min: 0.001, max: 0.05, default: 0.005, unit: 's', step: 0.001 },
      { key: 'release', label: 'Release', min: 0.03, max: 1, default: 0.22, unit: 's', step: 0.01 },
      { key: 'triggerPitch', label: 'Trigger Pitch (-1 any)', min: -1, max: 127, default: 36, step: 1 },
    ],
    choices: [{ key: 'source', label: 'Trigger Track', options: [], default: '' }],
  },
  gate: {
    type: 'gate', name: 'Noise Gate', description: 'Threshold gate with hold and release (AudioWorklet).',
    params: [
      { key: 'threshold', label: 'Threshold', min: -90, max: 0, default: -50, unit: 'dB', step: 0.5 },
      { key: 'attack', label: 'Attack', min: 0.0005, max: 0.05, default: 0.002, unit: 's', step: 0.0005 },
      { key: 'hold', label: 'Hold', min: 0, max: 0.5, default: 0.05, unit: 's', step: 0.005 },
      { key: 'release', label: 'Release', min: 0.01, max: 1, default: 0.1, unit: 's', step: 0.01 },
      { key: 'range', label: 'Range', min: -90, max: 0, default: -80, unit: 'dB' },
    ],
  },
  bitcrush: {
    type: 'bitcrush', name: 'Bitcrusher', description: 'Bit-depth reduction via quantizing waveshaper plus low-pass for lo-fi grit.',
    params: [
      { key: 'bits', label: 'Bits', min: 2, max: 16, default: 8, step: 1 },
      { key: 'tone', label: 'Tone', min: 1000, max: 20000, default: 9000, unit: 'Hz', log: true },
      { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.6, step: 0.01 },
    ],
  },
  gain: {
    type: 'gain', name: 'Utility Gain', description: 'Gain staging and polarity/mono utility.',
    params: [{ key: 'gain', label: 'Gain', min: -48, max: 24, default: 0, unit: 'dB', step: 0.1 }],
    toggles: [{ key: 'mono', label: 'Mono', default: false }, { key: 'invert', label: 'Invert Polarity', default: false }],
  },
};

export function defaultEffectParams(type: EffectType): Effect['params'] {
  const d = EFFECT_DEFS[type];
  const out: Effect['params'] = {};
  for (const p of d.params) out[p.key] = p.default;
  for (const c of d.choices ?? []) out[c.key] = c.default;
  for (const t of d.toggles ?? []) out[t.key] = t.default;
  return out;
}

export function makeEffect(type: EffectType, params: Partial<Effect['params']> = {}): Effect {
  return { id: uid('fx'), type, enabled: true, params: { ...defaultEffectParams(type), ...sanitizeParams(type, params) } };
}

/** Clamp numeric params into range and drop unknown keys. Used for AI-provided values too. */
export function sanitizeParams(type: EffectType, params: Partial<Effect['params']>): Effect['params'] {
  const d = EFFECT_DEFS[type];
  const out: Effect['params'] = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    const pd = d.params.find((p) => p.key === k);
    if (pd && typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(pd.max, Math.max(pd.min, v));
    const cd = d.choices?.find((c) => c.key === k);
    if (cd && typeof v === 'string' && (cd.options.length === 0 || cd.options.includes(v))) out[k] = v;
    const td = d.toggles?.find((t) => t.key === k);
    if (td && typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export const EFFECT_PRESETS: { name: string; type: EffectType; params: Partial<Effect['params']> }[] = [
  { name: 'Small Room', type: 'reverb', params: { decay: 0.9, predelay: 0.005, size: 0.3, mix: 0.18, tone: 6000 } },
  { name: 'Concert Hall', type: 'reverb', params: { decay: 3.6, predelay: 0.03, size: 0.8, mix: 0.3, tone: 6500 } },
  { name: 'Cinematic Hall', type: 'reverb', params: { decay: 6, predelay: 0.04, size: 1, mix: 0.35, tone: 5500 } },
  { name: 'Vocal Plate', type: 'reverb', params: { decay: 1.8, predelay: 0.02, size: 0.4, mix: 0.22, tone: 9000 } },
  { name: '1/8 Dotted Echo', type: 'delay', params: { time: 0.75, feedback: 0.4, mix: 0.22, pingpong: true } },
  { name: 'Slapback', type: 'delay', params: { time: 0.25, feedback: 0.1, mix: 0.2, pingpong: false } },
  { name: 'Vocal Comp', type: 'compressor', params: { threshold: -20, ratio: 3.5, attack: 0.005, release: 0.12, makeup: 4 } },
  { name: 'Drum Bus Glue', type: 'compressor', params: { threshold: -14, ratio: 2.5, attack: 0.02, release: 0.15, makeup: 2, mix: 0.7 } },
  { name: 'Bass Tight', type: 'compressor', params: { threshold: -22, ratio: 5, attack: 0.008, release: 0.1, makeup: 4 } },
  { name: 'Vocal Presence EQ', type: 'eq', params: { hpf: 90, mid1Freq: 300, mid1Gain: -2, mid2Freq: 3500, mid2Gain: 3, highGain: 2 } },
  { name: 'Kick Punch EQ', type: 'eq', params: { lowFreq: 60, lowGain: 3, mid1Freq: 350, mid1Gain: -4, mid2Freq: 4000, mid2Gain: 3 } },
  { name: 'Telephone', type: 'filter', params: { mode: 'bandpass', cutoff: 1500, resonance: 1.2 } },
  { name: 'Wah Sweep', type: 'filter', params: { mode: 'bandpass', cutoff: 800, resonance: 6, lfoRate: 1.5, lfoDepth: 1.8 } },
  { name: 'Guitar Crunch', type: 'distortion', params: { drive: 0.55, tone: 3500, output: -8, curve: 'soft' } },
  { name: 'Fuzz Lead', type: 'distortion', params: { drive: 0.85, tone: 2800, output: -12, curve: 'fuzz' } },
  { name: 'Tape Warmth', type: 'saturation', params: { drive: 5, warmth: 0.5 } },
  { name: 'Lo-Fi Crunch', type: 'bitcrush', params: { bits: 6, tone: 5000, mix: 0.5 } },
  { name: 'EDM Pump', type: 'ducking', params: { depth: 0.75, attack: 0.004, release: 0.25 } },
];

export interface MasteringPreset { id: string; name: string; description: string; chain: { type: EffectType; params: Partial<Effect['params']> }[] }

export const MASTERING_PRESETS: MasteringPreset[] = [
  { id: 'clean', name: 'Clean / Transparent', description: 'Safety limiter only.', chain: [
    { type: 'limiter', params: { gain: 0, ceiling: -1, release: 0.1 } },
  ] },
  { id: 'cinematic', name: 'Cinematic', description: 'Wide, deep, preserves dynamics with gentle glue.', chain: [
    { type: 'eq', params: { hpf: 25, lowFreq: 80, lowGain: 1.5, mid1Freq: 350, mid1Gain: -1, mid2Freq: 3000, mid2Gain: 0.5, highFreq: 10000, highGain: 1.5 } },
    { type: 'compressor', params: { threshold: -16, ratio: 1.8, attack: 0.03, release: 0.3, knee: 12, makeup: 1.5 } },
    { type: 'width', params: { width: 1.15, monoBelow: 120 } },
    { type: 'limiter', params: { gain: 0, ceiling: -1, release: 0.2 } },
  ] },
  { id: 'pop', name: 'Pop', description: 'Bright, present, competitive loudness.', chain: [
    { type: 'eq', params: { hpf: 30, lowFreq: 100, lowGain: 1.5, mid1Freq: 400, mid1Gain: -1.5, mid2Freq: 3500, mid2Gain: 1.5, highFreq: 11000, highGain: 2.5 } },
    { type: 'compressor', params: { threshold: -14, ratio: 2.5, attack: 0.015, release: 0.15, knee: 8, makeup: 2 } },
    { type: 'width', params: { width: 1.1, monoBelow: 140 } },
    { type: 'limiter', params: { gain: 4, ceiling: -1, release: 0.08 } },
  ] },
  { id: 'rock', name: 'Rock', description: 'Punchy mids, controlled lows, saturated glue.', chain: [
    { type: 'eq', params: { hpf: 30, lowFreq: 90, lowGain: 1, mid1Freq: 800, mid1Gain: 1, mid2Freq: 2500, mid2Gain: 1.5, highFreq: 9000, highGain: 1 } },
    { type: 'saturation', params: { drive: 3, warmth: 0.4, mix: 0.6 } },
    { type: 'compressor', params: { threshold: -15, ratio: 3, attack: 0.02, release: 0.12, knee: 6, makeup: 2 } },
    { type: 'limiter', params: { gain: 4, ceiling: -1, release: 0.08 } },
  ] },
  { id: 'electronic', name: 'Electronic / EDM', description: 'Heavy low end, mono bass, loud.', chain: [
    { type: 'eq', params: { hpf: 25, lowFreq: 60, lowGain: 2, mid1Freq: 300, mid1Gain: -2, mid2Freq: 4000, mid2Gain: 1, highFreq: 12000, highGain: 2 } },
    { type: 'compressor', params: { threshold: -12, ratio: 3, attack: 0.01, release: 0.1, knee: 6, makeup: 2 } },
    { type: 'width', params: { width: 1.2, monoBelow: 150 } },
    { type: 'limiter', params: { gain: 4, ceiling: -0.8, release: 0.06 } },
  ] },
  { id: 'acoustic', name: 'Acoustic', description: 'Natural, airy, light compression.', chain: [
    { type: 'eq', params: { hpf: 35, lowFreq: 120, lowGain: 0, mid1Freq: 250, mid1Gain: -1, mid2Freq: 5000, mid2Gain: 1, highFreq: 12000, highGain: 2 } },
    { type: 'compressor', params: { threshold: -18, ratio: 1.6, attack: 0.03, release: 0.25, knee: 12, makeup: 1 } },
    { type: 'limiter', params: { gain: 2, ceiling: -1, release: 0.15 } },
  ] },
  { id: 'classical', name: 'Classical', description: 'Maximum dynamic range, peak safety only.', chain: [
    { type: 'eq', params: { hpf: 20, highFreq: 12000, highGain: 0.5 } },
    { type: 'limiter', params: { gain: 0, ceiling: -1.5, release: 0.3 } },
  ] },
  { id: 'lofi', name: 'Lo-Fi', description: 'Warm, rolled-off highs, tape saturation.', chain: [
    { type: 'eq', params: { hpf: 40, lowFreq: 120, lowGain: 1.5, highFreq: 8000, highGain: -4 } },
    { type: 'saturation', params: { drive: 6, warmth: 0.7, mix: 0.8 } },
    { type: 'compressor', params: { threshold: -16, ratio: 2.5, attack: 0.02, release: 0.2, makeup: 2 } },
    { type: 'limiter', params: { gain: 3, ceiling: -1, release: 0.12 } },
  ] },
  { id: 'podcast', name: 'Podcast / Voice', description: 'Speech-focused: low cut, presence, firm leveling.', chain: [
    { type: 'eq', params: { hpf: 80, lowFreq: 150, lowGain: -1, mid1Freq: 300, mid1Gain: -2, mid2Freq: 3000, mid2Gain: 2.5, highFreq: 10000, highGain: 1 } },
    { type: 'compressor', params: { threshold: -24, ratio: 4, attack: 0.005, release: 0.15, knee: 6, makeup: 6 } },
    { type: 'limiter', params: { gain: 2, ceiling: -1, release: 0.1 } },
  ] },
];

export function masteringChain(presetId: string): Effect[] {
  const p = MASTERING_PRESETS.find((m) => m.id === presetId) ?? MASTERING_PRESETS[0];
  return p.chain.map((c) => makeEffect(c.type, c.params));
}
