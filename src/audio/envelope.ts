/**
 * Click-free ADSR helpers. Values at release time are computed analytically so that
 * releases never jump, even when a note ends during the attack or decay stage and
 * without relying on cancelAndHoldAtTime (unsupported in some browsers).
 */
import type { Envelope } from '../model/schema';

export const MIN_ATTACK = 0.0025;

export interface EnvShape { t0: number; base: number; peak: number; sustain: number; attack: number; decay: number }

export function envShape(t0: number, env: Envelope, peak: number, base = 0): EnvShape {
  return { t0, base, peak, sustain: base + (peak - base) * env.sustain, attack: Math.max(MIN_ATTACK, env.attack), decay: Math.max(0.005, env.decay) };
}

export function applyEnvStart(param: AudioParam, s: EnvShape) {
  param.cancelScheduledValues(s.t0);
  param.setValueAtTime(s.base, s.t0);
  param.linearRampToValueAtTime(s.peak, s.t0 + s.attack);
  // exponential approach to sustain; time constant = decay / 4 (≈98% at `decay`)
  param.setTargetAtTime(s.sustain, s.t0 + s.attack, s.decay / 4);
}

export function envValueAt(s: EnvShape, t: number): number {
  if (t <= s.t0) return s.base;
  if (t < s.t0 + s.attack) return s.base + ((s.peak - s.base) * (t - s.t0)) / s.attack;
  const dt = t - s.t0 - s.attack;
  return s.sustain + (s.peak - s.sustain) * Math.exp(-dt / (s.decay / 4));
}

/** Schedules release at `t`. Returns the time after which the voice is inaudible. */
export function applyEnvRelease(param: AudioParam, s: EnvShape, t: number, release: number, floor = s.base): number {
  const r = Math.max(0.008, release);
  const v = envValueAt(s, t);
  param.cancelScheduledValues(t);
  param.setValueAtTime(v, t);
  param.setTargetAtTime(floor, t, r / 5);
  return t + r * 1.15 + 0.02;
}

/** For velocity: maps 0..1 velocity with sensitivity into a linear gain. */
export function velocityGain(vel: number, sens: number) {
  const curved = Math.pow(Math.max(0, Math.min(1, vel)), 1.6);
  return 1 - sens + sens * curved;
}
