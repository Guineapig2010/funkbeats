export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dbToGain = (db: number) => (db <= -70 ? 0 : Math.pow(10, db / 20));
export const gainToDb = (g: number) => (g <= 0.0000001 ? -Infinity : 20 * Math.log10(g));
export const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const freqToMidi = (f: number) => 69 + 12 * Math.log2(f / 440);
export const round = (v: number, step: number) => Math.round(v / step) * step;
export const EPS = 1e-9;

/** Deterministic seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    float: (lo = 0, hi = 1) => lo + next() * (hi - lo),
    int: (lo: number, hi: number) => Math.floor(lo + next() * (hi - lo + 1)),
    chance: (p: number) => next() < p,
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    weighted: <T,>(items: readonly (readonly [T, number])[]): T => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of items) {
        if ((r -= w) <= 0) return v;
      }
      return items[items.length - 1][0];
    },
    gauss: (mean = 0, sd = 1) => {
      const u = Math.max(1e-9, next());
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}
export type Rng = ReturnType<typeof rng>;
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
