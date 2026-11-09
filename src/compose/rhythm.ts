/** Rhythm building blocks for melodies. Durations/positions in beats (quarter notes). */
import type { Rng } from '../util/math';

export interface Onset { start: number; dur: number; accent: boolean }

const CELLS: { cells: number[][]; density: number }[] = [
  { density: 0.1, cells: [[2], [-2], [1, -1]] },
  { density: 0.25, cells: [[1], [-1], [1.5, 0.5], [-0.5, 0.5]] },
  { density: 0.5, cells: [[0.5, 0.5], [1], [0.75, 0.25], [-0.5, 0.5], [1.5, 0.5]] },
  { density: 0.75, cells: [[0.5, 0.5], [0.25, 0.25, 0.5], [0.5, 0.25, 0.25], [0.75, 0.25]] },
  { density: 1, cells: [[0.25, 0.25, 0.25, 0.25], [0.25, 0.25, 0.5], [0.5, 0.25, 0.25]] },
];

/**
 * Generate a rhythm for `beats` beats. Negative entries are rests. Ensures the
 * phrase ends with a held note (phrase ending), and adds syncopation (anticipations).
 */
export function genRhythm(r: Rng, beats: number, density: number, syncopation: number, endHold = true): Onset[] {
  const out: Onset[] = [];
  let t = 0;
  while (t < beats - 1e-6) {
    const left = beats - t;
    // pick a density tier around the requested density
    const d = Math.max(0, Math.min(1, density + r.gauss(0, 0.15)));
    const tier = CELLS.reduce((a, b) => (Math.abs(b.density - d) < Math.abs(a.density - d) ? b : a));
    let cell = r.pick(tier.cells);
    const len = cell.reduce((s, x) => s + Math.abs(x), 0);
    if (len > left + 1e-6 || (len >= 2 && Math.abs(t % 1) > 1e-6)) cell = [left >= 1 ? 1 : left];
    for (const x of cell) {
      if (x > 0) out.push({ start: t, dur: x, accent: Math.abs(t % 2) < 1e-6 });
      t += Math.abs(x);
    }
  }
  // syncopation: anticipate some on-beat notes by an 8th (tie from previous offbeat)
  for (const o of out) {
    if (o.start > 0.5 && Math.abs(o.start % 1) < 1e-6 && r.chance(syncopation * 0.35)) {
      const prevEnd = out.filter((p) => p !== o && p.start < o.start).reduce((m, p) => Math.max(m, p.start + p.dur), 0);
      if (prevEnd <= o.start - 0.5 + 1e-6) { o.start -= 0.5; o.dur += 0.5; }
    }
  }
  if (endHold && out.length > 1) {
    // make the last note of the phrase long; leave a breath at the end
    const last = out[out.length - 1];
    if (last.start > beats - 1.01) {
      const prev = out[out.length - 2];
      if (prev && prev.start < beats - 1.5) { out.pop(); prev.dur = Math.max(prev.dur, beats - 0.5 - prev.start); }
    }
    const l = out[out.length - 1];
    l.dur = Math.max(l.dur, Math.min(2, beats - l.start - 0.25));
  }
  // clean overlaps
  out.sort((a, b) => a.start - b.start);
  for (let i = 0; i < out.length - 1; i++) out[i].dur = Math.min(out[i].dur, out[i + 1].start - out[i].start);
  return out.filter((o) => o.dur > 0.05);
}

/** Rhythm with exactly `count` onsets across `beats` (for syllable-aligned vocal lines). */
export function rhythmForCount(r: Rng, beats: number, count: number, syncopation: number): Onset[] {
  const n = Math.max(1, Math.min(count, Math.floor(beats * 4)));
  // choose the grid: 8ths if they fit comfortably, else 16ths
  const grid = n <= beats * 2 * 0.8 ? 0.5 : 0.25;
  const slots = Math.floor((beats - 1) / grid); // leave room for the held last note
  const chosen = new Set<number>([0]);
  // prefer strong positions, add syncopated ones by probability
  const weights: [number, number][] = [];
  for (let i = 1; i < slots; i++) {
    const pos = i * grid;
    const strong = Math.abs(pos % 1) < 1e-6 ? 3 : Math.abs(pos % 0.5) < 1e-6 ? 1.6 + syncopation : 0.8 + syncopation;
    weights.push([i, strong]);
  }
  while (chosen.size < n - 1 && weights.length) {
    const pick = r.weighted(weights.map(([i, w]) => [i, w] as const));
    chosen.add(pick);
    weights.splice(weights.findIndex(([i]) => i === pick), 1);
  }
  const starts = [...chosen].sort((a, b) => a - b).map((i) => i * grid);
  if (n > 1) starts.push(Math.min(beats - 1, Math.max(starts[starts.length - 1] + grid, beats - 1.5)));
  return starts.map((s, i) => ({ start: s, dur: (i < starts.length - 1 ? starts[i + 1] - s : Math.max(0.75, beats - s - 0.25)) * (i < starts.length - 1 ? 0.92 : 1), accent: Math.abs(s % 2) < 1e-6 }));
}
