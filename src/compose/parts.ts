/**
 * Part generators. Each takes a section context (chords, key, energy, register…)
 * and returns notes relative to the section start. Generators are deterministic
 * for a given RNG seed.
 */
import type { ModeName, SectionKind } from '../model/schema';
import type { Rng } from '../util/math';
import { bassNoteFor, chordPitchClasses, harmonicParent, inScale, pc, scaleStep, snapToScale, voiceChord, type ChordSpec } from '../theory/theory';
import { genRhythm, rhythmForCount, type Onset } from './rhythm';
import type { BassStyle, CompStyle, DrumStyle } from './styles';

export interface PNote { pitch: number; start: number; duration: number; velocity: number; lyric?: string }
export interface ChordSpan { start: number; end: number; chord: ChordSpec }

export interface PartContext {
  r: Rng;
  bars: number;
  bpb: number;
  chords: ChordSpan[];
  tonic: number;
  mode: ModeName;
  energy: number;
  kind: SectionKind;
  density: number;
  syncopation: number;
  complexity: number;
  creativity: number;
  center: number;
  prevKind: SectionKind | null;
  nextKind: SectionKind | null;
  nextEnergy: number;
  prevEnergy: number;
  isFirst: boolean;
  isLast: boolean;
  bpm: number;
}

export const beatsOf = (c: PartContext) => c.bars * c.bpb;
export function chordAt(c: PartContext, t: number): ChordSpec {
  for (const s of c.chords) if (t >= s.start - 1e-6 && t < s.end - 1e-6) return s.chord;
  return c.chords[c.chords.length - 1]?.chord ?? { root: c.tonic, quality: 'maj', bass: null };
}
const clampVel = (v: number) => Math.max(0.05, Math.min(1, v));
const baseVel = (c: PartContext, lo = 0.5, span = 0.4) => lo + span * c.energy;
const HIGH_KINDS: SectionKind[] = ['chorus', 'drop', 'climax', 'solo'];
export const isHigh = (k: SectionKind | null) => !!k && HIGH_KINDS.includes(k);

function nearestChordTone(pitch: number, chord: ChordSpec, lo = 0, hi = 127): number {
  const pcs = chordPitchClasses(chord);
  let best = pitch, bd = 99;
  for (let d = -7; d <= 7; d++) {
    const n = pitch + d;
    if (n < lo || n > hi) continue;
    if (pcs.includes(pc(n)) && Math.abs(d) < bd) { bd = Math.abs(d); best = n; }
  }
  return best;
}

// =====================================================================================
// MELODY / THEMES
// =====================================================================================

export interface Theme {
  /** Notes for the whole section (relative beats). */
  notes: PNote[];
  bars: number;
}

/**
 * Compose a melodic theme with motif development:
 * phrase A (motif) → A' (motif re-pitched to the new harmony / sequenced) → B (contrast) → cadence.
 */
export function composeMelody(c: PartContext, opts: { range: [number, number]; phraseBars?: number; lift?: number; sparse?: boolean } ): PNote[] {
  const r = c.r;
  const bpb = c.bpb;
  const phraseBars = opts.phraseBars ?? (c.bars >= 4 ? 2 : 1);
  const phraseBeats = phraseBars * bpb;
  const phrases = Math.max(1, Math.round(c.bars / phraseBars));
  const [lo, hi] = opts.range;
  const center = Math.round((lo + hi) / 2) + (opts.lift ?? 0);
  const melMode = c.mode;
  const density = Math.max(0.05, Math.min(1, (opts.sparse ? c.density * 0.6 : c.density) + (isHigh(c.kind) ? 0.1 : 0) + (c.energy - 0.5) * 0.2));
  const motif = genRhythm(r, phraseBeats, density, c.syncopation);
  const motifB = genRhythm(r, phraseBeats, Math.max(0.1, density - 0.15 + r.float(-0.1, 0.2)), c.syncopation);
  const cadenceRhythm: Onset[] = (() => {
    const base = motif.filter((o) => o.start < phraseBeats * 0.55).map((o) => ({ ...o }));
    const lastStart = Math.max(phraseBeats * 0.55, Math.ceil((base.length ? base[base.length - 1].start + base[base.length - 1].dur : 0) * 2) / 2);
    base.push({ start: Math.min(lastStart, phraseBeats - 1), dur: Math.max(1, phraseBeats - lastStart - 0.25), accent: true });
    for (let i = 0; i < base.length - 1; i++) base[i].dur = Math.min(base[i].dur, base[i + 1].start - base[i].start);
    return base;
  })();
  // contour of the motif as scale-step deltas
  const shape = r.pick(['arch', 'rise', 'fall', 'wave', 'arch'] as const);
  const motifSteps: number[] = motif.map((_, i) => {
    const x = motif.length > 1 ? i / (motif.length - 1) : 0;
    let target = 0;
    if (shape === 'arch') target = Math.sin(x * Math.PI) * 4;
    else if (shape === 'rise') target = x * 4;
    else if (shape === 'fall') target = 3 - x * 4;
    else target = Math.sin(x * Math.PI * 2) * 2.5;
    return Math.round(target + r.gauss(0, 0.6 + c.creativity * 0.6));
  });
  const out: PNote[] = [];
  let startPitch = nearestChordTone(snapToScale(center, c.tonic, melMode), chordAt(c, 0), lo, hi);
  for (let p = 0; p < phrases; p++) {
    const off = p * phraseBeats;
    const role = phrases === 1 ? 'cad' : p === phrases - 1 ? 'cad' : p % 4 === 2 ? 'B' : p % 2 === 1 ? "A'" : 'A';
    const rhythm = role === 'B' ? motifB : role === 'cad' ? cadenceRhythm : motif;
    // sequence: A' starts a step away; B starts higher for contrast
    const seqShift = role === "A'" ? r.pick([-1, 1, 2]) : role === 'B' ? r.pick([2, 3]) : role === 'cad' ? r.pick([0, 1]) : 0;
    const anchor = nearestChordTone(scaleStep(startPitch, seqShift, c.tonic, melMode), chordAt(c, off), lo, hi);
    let prev = anchor;
    rhythm.forEach((o, i) => {
      const t = off + o.start;
      if (t >= beatsOf(c) - 1e-6) return;
      const chord = chordAt(c, t);
      let pitch: number;
      if (i === 0) pitch = anchor;
      else {
        const stepsSrc = role === 'B' ? Math.round(Math.sin((i / rhythm.length) * Math.PI) * 3 - 1 + r.gauss(0, 0.8)) : (motifSteps[i] ?? 0);
        const target = scaleStep(anchor, stepsSrc, c.tonic, melMode);
        // move toward the target mostly stepwise
        let step = Math.sign(target - prev) * Math.min(Math.abs(target - prev), r.chance(0.18 + c.creativity * 0.2) ? 7 : 3);
        pitch = snapToScale(prev + step, c.tonic, melMode, step > 0);
      }
      const strong = Math.abs(o.start % 1) < 1e-6 && (Math.abs(t % c.bpb) < 1e-6 || o.dur >= 1);
      if (strong || o.dur >= 1.5) pitch = nearestChordTone(pitch, chord, lo, hi);
      // keep in range, fold back by octave
      while (pitch > hi) pitch -= 12;
      while (pitch < lo) pitch += 12;
      if (!inScale(pitch, c.tonic, melMode) && !chordPitchClasses(chord).includes(pc(pitch))) pitch = snapToScale(pitch, c.tonic, melMode);
      // cadence: final note resolves
      const isLastNote = i === rhythm.length - 1;
      if (role === 'cad' && isLastNote) {
        const goal = c.isLast || (p === phrases - 1 && !isHigh(c.nextKind)) ? c.tonic : chordPitchClasses(chord)[r.pick([0, 1, 2])];
        let best = pitch, bd = 99;
        for (let n = lo; n <= hi; n++) if (pc(n) === pc(goal) && Math.abs(n - prev) < bd) { bd = Math.abs(n - prev); best = n; }
        pitch = best;
      }
      const phrasePos = o.start / phraseBeats;
      const vel = clampVel(baseVel(c, 0.55, 0.35) + (o.accent ? 0.08 : 0) + Math.sin(phrasePos * Math.PI) * 0.06 + r.gauss(0, 0.03));
      out.push({ pitch, start: t, duration: Math.max(0.1, o.dur * (o.dur <= 0.5 ? 0.9 : 0.96)), velocity: vel });
      prev = pitch;
    });
    if (role === 'A') startPitch = anchor;
  }
  return out;
}

/** Re-fit an existing theme to new chords (keeps rhythm & contour) – used for repeated sections. */
export function refitTheme(notes: PNote[], c: PartContext, range: [number, number], transpose = 0): PNote[] {
  const [lo, hi] = range;
  return notes.filter((n) => n.start < beatsOf(c) - 1e-6).map((n) => {
    let p = n.pitch + transpose;
    const chord = chordAt(c, n.start);
    if (!inScale(p, c.tonic, c.mode)) p = snapToScale(p, c.tonic, c.mode);
    const strong = Math.abs(n.start % 1) < 1e-6 || n.duration >= 1.5;
    if (strong && !chordPitchClasses(chord).includes(pc(p))) p = nearestChordTone(p, chord, lo, hi);
    return { ...n, pitch: p };
  });
}

/** Light variation for repeats: occasional neighbour tones / rhythmic pushes. */
export function varyTheme(notes: PNote[], c: PartContext, amount: number): PNote[] {
  const r = c.r;
  return notes.map((n, i) => {
    const m = { ...n };
    if (i > 0 && r.chance(amount * 0.25)) m.pitch = scaleStep(n.pitch, r.pick([-1, 1]), c.tonic, c.mode);
    if (r.chance(amount * 0.1) && Math.abs(n.start % 1) < 1e-6 && n.start > 0.5) { m.start -= 0.25; m.duration += 0.25; }
    m.velocity = clampVel(n.velocity + (c.energy - 0.5) * 0.15);
    return m;
  });
}

/** Syllable-aligned vocal melody: one note per syllable, one lyric line per phrase. */
export function composeVocal(c: PartContext, lines: string[][], range: [number, number]): PNote[] {
  const r = c.r;
  const phraseBeats = 2 * c.bpb;
  const phrases = Math.max(1, Math.floor(c.bars / 2));
  const out: PNote[] = [];
  const [lo, hi] = range;
  let prev = nearestChordTone(snapToScale(Math.round((lo + hi) / 2) - 2, c.tonic, c.mode), chordAt(c, 0), lo, hi);
  const contourSeed = Array.from({ length: 16 }, () => Math.round(r.gauss(0, 1.3)));
  for (let p = 0; p < phrases; p++) {
    const syl = lines.length ? lines[p % lines.length] : [];
    const count = Math.max(3, Math.min(14, syl.length || 6));
    const rhythm = rhythmForCount(r, phraseBeats, count, c.syncopation);
    const lift = isHigh(c.kind) ? 2 : 0;
    rhythm.forEach((o, i) => {
      const t = p * phraseBeats + o.start;
      if (t >= beatsOf(c) - 1e-6) return;
      const chord = chordAt(c, t);
      const motion = p % 2 === 0 ? contourSeed[i % contourSeed.length] : -contourSeed[(i + 3) % contourSeed.length] * 0.7;
      let pitch = snapToScale(prev + Math.round(motion) + (i === 0 ? lift : 0), c.tonic, c.mode);
      if (Math.abs(o.start % 1) < 1e-6 || i === rhythm.length - 1) pitch = nearestChordTone(pitch, chord, lo, hi);
      while (pitch > hi) pitch -= 12;
      while (pitch < lo) pitch += 12;
      out.push({ pitch, start: t, duration: Math.max(0.15, o.dur), velocity: clampVel(baseVel(c, 0.6, 0.3) + (o.accent ? 0.06 : 0)), lyric: syl[i] });
      prev = pitch;
    });
  }
  return out;
}

/** Diatonic harmony a third (or sixth) below/above a melody. */
export function harmonize(melody: PNote[], c: PartContext, interval: 'third-below' | 'third-above' | 'sixth-below' = 'third-below'): PNote[] {
  const steps = interval === 'third-below' ? -2 : interval === 'third-above' ? 2 : -5;
  return melody.map((n) => {
    let p = scaleStep(n.pitch, steps, c.tonic, harmonicParent(c.mode));
    const chord = chordAt(c, n.start);
    if (!chordPitchClasses(chord).includes(pc(p)) && n.duration >= 1) p = nearestChordTone(p, chord);
    return { ...n, pitch: p, velocity: clampVel(n.velocity * 0.85), lyric: n.lyric };
  });
}

/** Countermelody: guide tones that move stepwise, placed where the melody rests or holds. */
export function composeCounter(c: PartContext, melody: PNote[], range: [number, number]): PNote[] {
  const out: PNote[] = [];
  const [lo, hi] = range;
  let prev = Math.round((lo + hi) / 2);
  for (const span of c.chords) {
    const pcs = chordPitchClasses(span.chord);
    const guide = [pcs[1] ?? pcs[0], pcs[3] ?? pcs[2] ?? pcs[0]];
    let best = prev, bd = 99;
    for (let n = lo; n <= hi; n++) if (guide.includes(pc(n)) && Math.abs(n - prev) < bd) { bd = Math.abs(n - prev); best = n; }
    const len = span.end - span.start;
    const busy = melody.filter((m) => m.start >= span.start && m.start < span.end).length;
    if (busy > len * 1.5 && c.r.chance(0.5)) {
      // melody busy: one sustained note
      out.push({ pitch: best, start: span.start, duration: len * 0.98, velocity: clampVel(baseVel(c, 0.45, 0.3)) });
    } else {
      out.push({ pitch: best, start: span.start, duration: len / 2 * 0.98, velocity: clampVel(baseVel(c, 0.45, 0.3)) });
      const passing = snapToScale(best + (c.r.chance(0.5) ? 2 : -1), c.tonic, c.mode);
      out.push({ pitch: Math.max(lo, Math.min(hi, passing)), start: span.start + len / 2, duration: len / 2 * 0.98, velocity: clampVel(baseVel(c, 0.42, 0.3)) });
    }
    prev = best;
  }
  return out;
}

// =====================================================================================
// BASS
// =====================================================================================
export function composeBass(c: PartContext, style: BassStyle, center = 38): PNote[] {
  const r = c.r;
  const out: PNote[] = [];
  const v = baseVel(c, 0.6, 0.35);
  const beats = beatsOf(c);
  const push = (pitch: number, start: number, duration: number, vel = v) => {
    if (start < beats - 1e-6) out.push({ pitch, start, duration: Math.min(duration, beats - start), velocity: clampVel(vel + r.gauss(0, 0.03)) });
  };
  const low = c.energy < 0.45;
  for (let bar = 0; bar < c.bars; bar++) {
    const b0 = bar * c.bpb;
    for (const span of c.chords.filter((s) => s.start < b0 + c.bpb - 1e-6 && s.end > b0 + 1e-6)) {
      const s = Math.max(span.start, b0), e = Math.min(span.end, b0 + c.bpb);
      const root = bassNoteFor(span.chord, center);
      const fifth = root + 7 > center + 9 ? root - 5 : root + 7;
      const nextSpan = c.chords.find((x) => x.start >= e - 1e-6);
      const nextRoot = nextSpan ? bassNoteFor(nextSpan.chord, center) : root;
      const len = e - s;
      switch (style) {
        case 'sustain':
          push(root, s, len * 0.98, v * 0.9);
          break;
        case 'root-eighths': {
          const step = low ? 1 : 0.5;
          for (let t = s; t < e - 1e-6; t += step) {
            const approaching = t >= e - step * 1.01 && nextRoot !== root && r.chance(0.5);
            push(approaching ? snapToScale(nextRoot + (nextRoot > root ? -1 : 1) * 2, c.tonic, c.mode) : root, t, step * 0.85, Math.abs(t % 1) < 1e-6 ? v : v * 0.85);
          }
          break;
        }
        case 'gallop': {
          for (let t = s; t < e - 1e-6; t += 1) {
            push(root, t, 0.45, v); push(root, t + 0.5, 0.22, v * 0.8); push(root, t + 0.75, 0.22, v * 0.8);
          }
          break;
        }
        case 'octave-pump': {
          for (let t = s; t < e - 1e-6; t += 0.5) {
            const off = Math.abs(t % 1 - 0.5) < 1e-6;
            if (!off && low) continue;
            push(off ? root + 12 : root, t, 0.4, off ? v : v * 0.85);
          }
          break;
        }
        case 'walking': {
          const pcs = chordPitchClasses(span.chord);
          for (let t = s, i = 0; t < e - 1e-6; t += 1, i++) {
            let p: number;
            if (i === 0) p = root;
            else if (t >= e - 1.01) p = nextRoot + (r.chance(0.5) ? 1 : -1); // chromatic approach
            else {
              const target = pcs[(i % (pcs.length - 1)) + 1];
              p = root + ((target - pc(root) + 12) % 12);
              if (p > center + 10) p -= 12;
            }
            push(p, t, 0.9, v * (i === 0 ? 1 : 0.85));
          }
          break;
        }
        case '808': {
          const hits = r.pick([[0, 1.5, 2.5], [0, 0.75, 2], [0, 2, 3.5], [0, 1.75, 2.5, 3.25]]);
          const list = hits.map((h) => s + h).filter((t) => t < e - 1e-6);
          list.forEach((t, i) => {
            const end = i < list.length - 1 ? list[i + 1] : e;
            const p = i > 0 && r.chance(0.25) ? root + r.pick([12, 7, -5]) : root;
            push(p, t, (end - t) * 0.95, v);
          });
          break;
        }
        case 'syncopated': {
          const pats = [[0, 0.75, 1.5, 2.5, 3], [0, 1, 1.75, 2.5, 3.5], [0, 0.5, 1.5, 2, 2.75, 3.5], [0, 1.5, 2, 3, 3.75]];
          const pat = low ? [0, 2] : r.pick(pats);
          const list = pat.map((h) => s + h).filter((t) => t < e - 1e-6);
          list.forEach((t, i) => {
            const end = i < list.length - 1 ? list[i + 1] : e;
            const p = i > 0 && r.chance(0.3) ? (r.chance(0.5) ? root + 12 : fifth) : root;
            push(p, t, Math.min(0.9, (end - t) * 0.8), i === 0 ? v : v * 0.85);
          });
          break;
        }
        case 'root-fifth': {
          for (let t = s, i = 0; t < e - 1e-6; t += 1, i++) {
            if (i % 2 === 1 && !low) continue;
            push(i % 4 < 2 ? root : fifth, t, 0.8, v);
          }
          if (len >= 4 && !low && nextRoot !== root) { push(snapToScale(nextRoot - 2, c.tonic, c.mode), s + 3, 0.45, v * 0.8); push(snapToScale(nextRoot - 1, c.tonic, c.mode), s + 3.5, 0.45, v * 0.8); }
          break;
        }
        case 'arp-bass': {
          const pat = [0, 0, 12, 0, 0, 12, 0, 12];
          for (let t = s, i = 0; t < e - 1e-6; t += 0.5, i++) push(root + pat[i % pat.length], t, 0.4, i % 2 === 0 ? v : v * 0.8);
          break;
        }
        case 'reese':
          push(root, s, len * 0.98, v);
          break;
      }
    }
  }
  // sustained styles: merge identical consecutive roots into long notes
  if (style === 'sustain' || style === 'reese') return mergeTies(out);
  return out;
}

function mergeTies(notes: PNote[]): PNote[] {
  const out: PNote[] = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && last.pitch === n.pitch && Math.abs(last.start + last.duration - n.start) < 0.1) last.duration = n.start + n.duration - last.start;
    else out.push({ ...n });
  }
  return out;
}

// =====================================================================================
// CHORDS / ACCOMPANIMENT
// =====================================================================================
export function composeComp(c: PartContext, style: CompStyle, center = 60, voices = 4): PNote[] {
  const r = c.r;
  const out: PNote[] = [];
  const beats = beatsOf(c);
  let prevVoicing: number[] | null = null;
  const v = baseVel(c, 0.45, 0.35);
  const add = (pitch: number, start: number, duration: number, vel: number) => {
    if (start < beats - 1e-6 && pitch > 0 && pitch < 128) out.push({ pitch, start, duration: Math.max(0.05, Math.min(duration, beats - start)), velocity: clampVel(vel + r.gauss(0, 0.025)) });
  };
  const chordNotes = (chord: ChordSpec, n = voices, ctr = center) => {
    const vc = voiceChord(chord, prevVoicing, ctr, n);
    prevVoicing = vc;
    return vc;
  };
  for (const span of c.chords) {
    const len = span.end - span.start;
    const s = span.start;
    switch (style) {
      case 'pad': {
        const vc = chordNotes(span.chord, c.energy > 0.8 ? voices + 1 : voices);
        for (const p of vc) add(p, s, len * 0.995, v * 0.85);
        break;
      }
      case 'block': {
        const vc = chordNotes(span.chord);
        const pat = c.energy < 0.45 ? [[0, len]] : c.energy < 0.75 ? (len >= 4 ? [[0, 1.5], [1.5, 1], [2.5, 1.5]] : [[0, len]]) : (len >= 4 ? [[0, 0.75], [0.75, 0.75], [1.5, 1], [2.5, 0.5], [3, 1]] : [[0, len / 2], [len / 2, len / 2]]);
        for (const [o, d] of pat) for (const p of vc) add(p, s + o, d * 0.95, o === 0 ? v : v * 0.85);
        // left hand root
        add(bassNoteFor(span.chord, center - 22), s, len * 0.95, v * 0.9);
        break;
      }
      case 'broken': {
        const vc = chordNotes(span.chord, 3, center + 2);
        const root = bassNoteFor(span.chord, center - 10);
        const step = c.bpm > 110 || c.energy < 0.35 ? 1 : 0.5;
        const seq = [root, vc[0], vc[1], vc[2], vc[1], vc[0]];
        const alberti = [root, vc[2], vc[1], vc[2]];
        const use = c.r.chance(0.5) ? seq : alberti;
        for (let t = 0, i = 0; t < len - 1e-6; t += step, i++) add(use[i % use.length], s + t, step * (i === 0 ? 3 : 1.8), i === 0 ? v : v * 0.8);
        break;
      }
      case 'arp': {
        const pcs = voiceChord(span.chord, null, center, 4);
        const pool = [...pcs, ...pcs.map((p) => p + 12)];
        const pattern = r.pick(['up', 'updown', 'up', 'random'] as const);
        const step = c.energy < 0.5 || c.bpm > 135 ? 0.5 : 0.25;
        for (let t = 0, i = 0; t < len - 1e-6; t += step, i++) {
          let idx: number;
          if (pattern === 'up') idx = i % pool.length;
          else if (pattern === 'updown') { const k = i % (pool.length * 2 - 2); idx = k < pool.length ? k : pool.length * 2 - 2 - k; }
          else idx = r.int(0, pool.length - 1);
          add(pool[idx], s + t, step * 0.9, (Math.abs(t % 1) < 1e-6 ? v : v * 0.8));
        }
        break;
      }
      case 'strum': {
        const vc = voiceChord(span.chord, prevVoicing, center - 2, 5);
        prevVoicing = vc;
        const pat = c.energy < 0.45 ? [[0, 'D']] : [[0, 'D'], [1, 'D'], [1.5, 'U'], [2.5, 'U'], [3, 'D'], [3.5, 'U']];
        for (const [o, dir] of pat as [number, string][]) {
          if (o >= len - 1e-6) continue;
          const order = dir === 'D' ? vc : [...vc].reverse();
          const vel = dir === 'D' ? v : v * 0.7;
          order.forEach((p, i) => add(p, s + o + i * 0.018, Math.min(len - o, 1) * 0.95, vel - i * 0.02));
        }
        break;
      }
      case 'stabs': {
        const vc = chordNotes(span.chord, 3);
        const pats = [[0, 0.75, 1.5, 2.5, 3.25], [0.5, 1.5, 2.5, 3.5], [0, 0.75, 1.5, 2, 3], [0, 1.5, 2.25, 3]];
        const pat = c.energy < 0.5 ? [0] : r.pick(pats);
        for (const o of pat) if (o < len) for (const p of vc) add(p, s + o, 0.3, v);
        break;
      }
      case 'offbeat': {
        const vc = chordNotes(span.chord, 3);
        for (let o = 0.5; o < len; o += 1) for (const p of vc) add(p, s + o, 0.28, v);
        break;
      }
      case 'ostinato': {
        const root = bassNoteFor(span.chord, center - 5);
        const pcs = chordPitchClasses(span.chord);
        const fifth = root + ((pcs[2] ?? pcs[1] ?? 7) - pc(root) + 12) % 12;
        const third = root + ((pcs[1] ?? 4) - pc(root) + 12) % 12;
        const figures = [[root, root, fifth, root, root + 12, root, fifth, root], [root, fifth, root + 12, fifth], [root, third, fifth, root + 12, fifth, third], [root, root, root + 12, root]];
        const fig = figures[(c.bars + Math.round(c.energy * 3)) % figures.length];
        const step = c.energy > 0.75 ? 0.25 : 0.5;
        for (let t = 0, i = 0; t < len - 1e-6; t += step, i++) add(fig[i % fig.length], s + t, step * 0.7, Math.abs(t % 1) < 1e-6 ? v * 1.05 : v * 0.8);
        break;
      }
      case 'jazz-comp': {
        // rootless voicing (3-7-9-5)
        const pcs = chordPitchClasses(span.chord);
        const rootless = [pcs[1], pcs[3] ?? pcs[2], pc(span.chord.root + 2), pcs[2]].filter((x) => x !== undefined) as number[];
        const vc = voiceChord({ ...span.chord }, prevVoicing, center, 4).map((p, i) => {
          const target = rootless[i % rootless.length];
          let n = p - ((pc(p) - target + 12) % 12);
          if (n < center - 8) n += 12;
          return n;
        }).sort((a, b) => a - b);
        prevVoicing = vc;
        const hits = r.pick([[0, 1.5], [0.5, 2.5], [1.5, 3], [0, 2.5, 3.5], [1, 2.5]]);
        for (const o of hits) if (o < len) for (const p of vc) add(p, s + o, r.pick([0.4, 0.9, 0.3]), v * 0.85);
        break;
      }
      case 'power': {
        const root = bassNoteFor(span.chord, center - 14);
        const notes = [root, root + 7, root + 12];
        if (c.energy < 0.5) { for (const p of notes) add(p, s, len * 0.95, v); break; }
        const step = c.energy > 0.85 ? 0.25 : 0.5;
        for (let t = 0; t < len - 1e-6; t += step) {
          const accent = Math.abs(t % 1) < 1e-6;
          for (const p of notes) add(p, s + t, step * (accent ? 0.85 : 0.6), accent ? v : v * 0.75);
        }
        break;
      }
    }
  }
  return out;
}

// =====================================================================================
// BRASS
// =====================================================================================
export function composeBrass(c: PartContext, melody: PNote[] | null, range: [number, number]): PNote[] {
  const out: PNote[] = [];
  const [lo, hi] = range;
  if (melody && melody.length && c.energy >= 0.85) {
    // heroic doubling of the theme, an octave down, slightly legato
    for (const n of melody) {
      let p = n.pitch - 12;
      while (p < lo) p += 12;
      while (p > hi) p -= 12;
      out.push({ ...n, pitch: p, velocity: clampVel(n.velocity + 0.05), duration: n.duration * 1.02, lyric: undefined });
    }
    return out;
  }
  // fanfare: dotted rhythmic stabs on chord tones
  let prev: number[] | null = null;
  for (const span of c.chords) {
    const vc = voiceChord(span.chord, prev, Math.round((lo + hi) / 2), 3);
    prev = vc;
    const len = span.end - span.start;
    const fig: [number, number][] = c.energy > 0.65 ? [[0, 0.7], [0.75, 0.2], [1, 1.9], [3, 0.9]] : [[0, len * 0.95]];
    for (const [o, d] of fig) if (o < len) for (const p of vc) out.push({ pitch: p, start: span.start + o, duration: Math.min(d, len - o), velocity: clampVel(baseVel(c, 0.55, 0.35) + (o === 0 ? 0.05 : 0)) });
  }
  return out;
}

// =====================================================================================
// DRUMS
// =====================================================================================
const K = 36, S = 38, RIM = 37, CL = 39, CH = 42, PH = 44, OH = 46, TL = 41, TM = 45, TH = 48, CR = 49, RD = 51, TAMB = 54, SHK = 70, TAIKO = 35, SWELL = 52, GONG = 57, SNAP = 40;

type Grid = Map<number, (number | 0)[]>; // pitch -> velocities per 16th step

function grid16(steps: number): Grid { return new Map<number, number[]>().set(K, new Array(steps).fill(0)) as Grid; }
function setSteps(g: Grid, pitch: number, steps: number[], vel: number, total: number) {
  let arr = g.get(pitch);
  if (!arr) { arr = new Array(total).fill(0); g.set(pitch, arr); }
  for (const s of steps) if (s < total) arr[s] = Math.max(arr[s] as number, vel);
}

function barPattern(style: DrumStyle, energy: number, stepsPerBar: number, r: Rng, variation: boolean): Grid {
  const g = grid16(stepsPerBar);
  const N = stepsPerBar;
  const all = (every: number, off = 0) => Array.from({ length: Math.floor((N - off) / every + 0.0001) }, (_, i) => off + i * every).filter((x) => x < N);
  const low = energy < 0.5, high = energy > 0.8;
  const q = N / 4; // steps per beat assuming 4 beats (non-4/4 handled generically below)
  if (N !== 16) {
    // generic odd meters: kick on 1, snare on the middle beat-group, hats on 8ths
    setSteps(g, K, [0], 1, N);
    setSteps(g, S, [Math.floor(N / 2)], 0.95, N);
    if (!low) setSteps(g, CH, all(2), 0.55, N);
    if (high) setSteps(g, K, [Math.floor(N * 0.75)], 0.8, N);
    return g;
  }
  switch (style) {
    case 'four-floor':
      setSteps(g, K, all(4), 1, N);
      if (!low) setSteps(g, CL, [4, 12], 0.9, N);
      setSteps(g, CH, all(4, 2), 0.7, N);
      if (high) { setSteps(g, OH, all(4, 2), 0.6, N); setSteps(g, SHK, all(1), 0.32, N); }
      else if (!low) setSteps(g, SHK, all(2, 1), 0.3, N);
      if (variation) setSteps(g, K, [14], 0.6, N);
      break;
    case 'backbeat': case 'ballad':
      setSteps(g, K, style === 'ballad' ? [0, 10] : [0, 6, 8], 0.95, N);
      setSteps(g, style === 'ballad' && low ? RIM : S, style === 'ballad' ? [8] : [4, 12], 0.9, N);
      setSteps(g, CH, all(2), 0.55, N);
      if (high) { setSteps(g, CL, [4, 12], 0.7, N); setSteps(g, TAMB, all(4, 2), 0.4, N); }
      if (variation) setSteps(g, K, [3, 10], 0.65, N);
      break;
    case 'rock':
      setSteps(g, K, [0, 8, 10], 1, N);
      setSteps(g, S, [4, 12], 1, N);
      setSteps(g, high ? RD : CH, all(2), high ? 0.55 : 0.6, N);
      if (variation) setSteps(g, K, [7], 0.8, N);
      if (!low) setSteps(g, S, [15], 0.35, N);
      break;
    case 'metal':
      if (high) setSteps(g, K, all(1), 0.85, N); else setSteps(g, K, [0, 2, 8, 10, 11], 0.95, N);
      setSteps(g, S, [4, 12], 1, N);
      setSteps(g, high ? CR : CH, all(high ? 4 : 2), high ? 0.55 : 0.6, N);
      break;
    case 'trap': case 'halftime': {
      setSteps(g, K, style === 'trap' ? r.pick([[0, 7, 10], [0, 3, 10, 11], [0, 6, 14]]) : [0, 10], 1, N);
      setSteps(g, style === 'trap' ? CL : S, [8], 1, N);
      if (style === 'trap') setSteps(g, S, [8], 0.8, N);
      setSteps(g, CH, all(2), 0.6, N);
      if (style === 'trap' && !low) {
        // hi-hat rolls (16ths, sometimes 32nds handled by caller via ratchets)
        const rollAt = r.pick([6, 14, 10, 12]);
        setSteps(g, CH, [rollAt, rollAt + 1], 0.5, N);
        if (high) setSteps(g, CH, all(1), 0.45, N);
      }
      if (high) setSteps(g, OH, [14], 0.5, N);
      break;
    }
    case 'boom-bap': case 'lofi':
      setSteps(g, K, r.pick([[0, 7, 10], [0, 3, 8, 10], [0, 9, 10]]), 0.95, N);
      setSteps(g, style === 'lofi' && low ? RIM : S, [4, 12], 0.9, N);
      setSteps(g, CH, all(2), style === 'lofi' ? 0.45 : 0.55, N);
      if (style === 'lofi') setSteps(g, SHK, all(4, 2), 0.25, N);
      if (variation) setSteps(g, OH, [14], 0.4, N);
      break;
    case 'dnb':
      setSteps(g, K, [0, 10], 1, N);
      setSteps(g, S, [4, 12], 1, N);
      setSteps(g, S, [7, 9, 15], 0.3, N); // ghosts
      setSteps(g, CH, all(2), 0.55, N);
      if (high) setSteps(g, RD, all(2, 1), 0.4, N);
      break;
    case 'jazz':
      setSteps(g, RD, [0, 4, 7, 8, 12, 15], 0.6, N); // swing feel comes from clip swing
      setSteps(g, PH, [4, 12], 0.5, N);
      setSteps(g, K, all(4), 0.25, N);
      if (!low) setSteps(g, S, [r.pick([6, 7, 10, 11, 14])], 0.35, N);
      break;
    case 'country':
      setSteps(g, K, [0, 8], 0.9, N);
      setSteps(g, S, all(2), 0.4, N);
      setSteps(g, S, [4, 12], 0.95, N);
      setSteps(g, CH, all(4, 2), 0.4, N);
      break;
    case 'funk':
      setSteps(g, K, r.pick([[0, 3, 10], [0, 6, 10, 13], [0, 7, 10]]), 1, N);
      setSteps(g, S, [4, 12], 1, N);
      setSteps(g, S, [2, 7, 9, 15], 0.28, N);
      setSteps(g, CH, all(1), 0.42, N);
      setSteps(g, CH, all(4), 0.6, N);
      if (high) setSteps(g, OH, [6], 0.5, N);
      break;
    case 'synthwave':
      setSteps(g, K, [0, 8, 10], 1, N);
      setSteps(g, S, [4, 12], 1, N);
      setSteps(g, CH, all(high ? 1 : 2), 0.45, N);
      if (high) setSteps(g, CL, [4, 12], 0.6, N);
      break;
    case 'reggaeton':
      setSteps(g, K, all(4), 1, N);
      setSteps(g, S, [3, 6, 11, 14], 0.9, N);
      setSteps(g, CH, all(2), 0.5, N);
      break;
    case 'orchestral': {
      // taiko ensemble patterns
      if (low) setSteps(g, TAIKO, [0], 0.85, N);
      else if (!high) { setSteps(g, TAIKO, [0, 8], 0.95, N); setSteps(g, TL, [6, 14], 0.6, N); }
      else {
        setSteps(g, TAIKO, r.pick([[0, 3, 6, 8, 11, 14], [0, 6, 8, 10, 12], [0, 3, 8, 11, 12, 14]]), 1, N);
        setSteps(g, TL, [4, 12], 0.7, N);
        setSteps(g, S, [2, 6, 10, 14], 0.35, N);
      }
      break;
    }
    case 'ambient-perc':
      setSteps(g, SHK, all(2), 0.3, N);
      setSteps(g, RIM, [6], 0.3, N);
      break;
    case 'none':
      break;
  }
  if (q !== 4) return g;
  return g;
}

export function composeDrums(c: PartContext, style: DrumStyle, opts: { humanize: number }): PNote[] {
  const r = c.r;
  const out: PNote[] = [];
  if (style === 'none') return out;
  const spb = c.bpb === 3 ? 12 : c.bpb === 4 ? 16 : Math.round(c.bpb * 4);
  const stepLen = c.bpb / spb;
  const beats = beatsOf(c);
  const energyScale = 0.55 + 0.45 * c.energy;
  const kind = c.kind;
  const buildup = kind === 'buildup';
  const nextIsBig = isHigh(c.nextKind) || (c.nextEnergy - c.energy > 0.2);
  const add = (pitch: number, t: number, vel: number, dur = 0.25) => {
    if (t < beats - 1e-6 && t >= 0) out.push({ pitch, start: Math.max(0, t + r.gauss(0, 0.004 * opts.humanize)), duration: dur, velocity: clampVel(vel * energyScale + r.gauss(0, 0.04 * opts.humanize)) });
  };
  for (let bar = 0; bar < c.bars; bar++) {
    const b0 = bar * c.bpb;
    const lastBar = bar === c.bars - 1;
    const fillBar = lastBar && !c.isLast && c.energy >= 0.4 && style !== 'jazz';
    if (buildup && style !== 'orchestral') {
      // EDM/pop build: accelerating snare roll with crescendo, kick on quarters
      const prog = bar / Math.max(1, c.bars - 1);
      const div = prog < 0.25 ? 1 : prog < 0.5 ? 0.5 : prog < 0.8 ? 0.25 : 0.125;
      for (let t = 0; t < c.bpb - 1e-6; t += div) add(S, b0 + t, 0.35 + 0.6 * ((bar + t / c.bpb) / c.bars), 0.1);
      if (prog < 0.85) for (let t = 0; t < c.bpb; t += 1) add(K, b0 + t, 0.85);
      continue;
    }
    if (buildup && style === 'orchestral') {
      for (let t = 0; t < c.bpb - 1e-6; t += bar >= c.bars - 2 ? 0.125 : 0.25) add(S, b0 + t, 0.3 + 0.6 * ((bar + t / c.bpb) / c.bars), 0.1);
      add(TAIKO, b0, 0.9);
      if (bar === c.bars - 2) add(SWELL, b0, 0.8, c.bpb * 2);
      continue;
    }
    const variation = bar % 4 === 3 || (bar % 2 === 1 && r.chance(0.3));
    const g = barPattern(style, c.energy, spb, r, variation);
    for (const [pitch, vels] of g) {
      vels.forEach((v, i) => {
        if (!v) return;
        const t = b0 + i * stepLen;
        if (fillBar && t >= b0 + c.bpb - (c.energy > 0.7 ? 2 : 1) - 1e-6 && pitch !== K && pitch !== CH && pitch !== RD) return;
        add(pitch, t, v as number);
      });
    }
    // trap ratchets: hi-hat 32nd / triplet rolls
    if (style === 'trap' && c.energy > 0.55 && r.chance(0.6)) {
      const at = b0 + r.pick([1.5, 3, 3.5, 2.5]);
      const trip = r.chance(0.5);
      const n = trip ? 3 : 4;
      for (let k = 0; k < n; k++) add(CH, at + k * (trip ? 1 / 6 : 0.125), 0.4 + k * 0.08, 0.05);
    }
    // crash on section downbeat when energy rises
    if (bar === 0 && (c.energy >= 0.6 && (isHigh(kind) || c.energy - c.prevEnergy > 0.15 || c.isFirst === false)) && style !== 'jazz' && style !== 'ambient-perc') add(style === 'orchestral' ? CR : CR, b0, 0.9, 2);
    if (bar === 0 && style === 'orchestral' && (kind === 'climax') && c.energy >= 0.95) add(GONG, b0, 0.9, 4);
    // fills
    if (fillBar) {
      const fillBeats = c.energy > 0.7 ? 2 : 1;
      const fs = b0 + c.bpb - fillBeats;
      if (style === 'orchestral') {
        for (let t = 0; t < fillBeats - 1e-6; t += 0.25) add(t < fillBeats / 2 ? TL : TAIKO, fs + t, 0.6 + 0.35 * (t / fillBeats));
        if (nextIsBig) add(SWELL, b0, 0.7, c.bpb);
      } else if (['four-floor', 'trap', 'halftime'].includes(style)) {
        for (let t = 0; t < fillBeats - 1e-6; t += 0.25) add(style === 'four-floor' ? CL : S, fs + t, 0.5 + 0.45 * (t / fillBeats));
      } else {
        const toms = [TH, TH, TM, TM, TL, TL, K, TL];
        const seq = r.chance(0.5) ? toms : [S, S, TH, TM, S, TM, TL, TL];
        let i = 0;
        for (let t = 0; t < fillBeats - 1e-6; t += fillBeats > 1 ? 0.25 : 0.25, i++) add(seq[Math.floor((i / (fillBeats * 4)) * seq.length)], fs + t, 0.6 + 0.35 * (t / fillBeats));
      }
    }
  }
  // final hit at the very end of the song
  if (c.isLast) add(style === 'orchestral' ? TAIKO : K, beats - c.bpb, 0.9), add(CR, beats - c.bpb, 0.85, 4);
  return out;
}

// =====================================================================================
// FX / special parts
// =====================================================================================
export function composeFx(c: PartContext, preset: string): PNote[] {
  const beats = beatsOf(c);
  const out: PNote[] = [];
  const root = c.chords[0]?.chord.root ?? c.tonic;
  if (preset === 'noise-riser') {
    const nextBig = isHigh(c.nextKind) || c.nextEnergy - c.energy > 0.2;
    if (c.kind === 'buildup') out.push({ pitch: 60, start: 0, duration: beats, velocity: 0.9 });
    else if (nextBig && c.bars >= 4) out.push({ pitch: 60, start: beats - 2 * c.bpb, duration: 2 * c.bpb, velocity: 0.75 });
  } else if (preset === 'impact') {
    if (isHigh(c.kind) || c.energy - c.prevEnergy > 0.25) out.push({ pitch: 24 + pc(root), start: 0, duration: c.bpb * 2, velocity: 1 });
  } else if (preset === 'timpani') {
    const r1 = 36 + ((pc(root) - 0 + 12) % 12);
    const p = r1 > 50 ? r1 - 12 : r1;
    if (c.kind === 'buildup' || (isHigh(c.nextKind) && c.bars >= 2)) {
      const startRoll = c.kind === 'buildup' ? 0 : beats - c.bpb;
      for (let t = startRoll; t < beats - 1e-6; t += 0.125) out.push({ pitch: p, start: t, duration: 0.12, velocity: clampVel(0.35 + 0.6 * ((t - startRoll) / (beats - startRoll))) });
    }
    if (isHigh(c.kind) || c.energy >= 0.8) {
      for (let bar = 0; bar < c.bars; bar += 1) {
        const span = c.chords.find((s) => s.start <= bar * c.bpb + 1e-6 && s.end > bar * c.bpb) ?? c.chords[0];
        const tp = 36 + pc(span.chord.root);
        out.push({ pitch: tp > 50 ? tp - 12 : tp, start: bar * c.bpb, duration: 1, velocity: 0.95 });
        if (c.energy > 0.9) out.push({ pitch: (tp > 50 ? tp - 12 : tp) + 7, start: bar * c.bpb + 2, duration: 1, velocity: 0.8 });
      }
    }
  } else if (preset === 'rain-ambience' || preset === 'drone') {
    out.push({ pitch: preset === 'drone' ? 36 + pc(c.tonic) : 66, start: 0, duration: beats, velocity: 0.7 });
  } else {
    // generic pad-like texture
    out.push({ pitch: 60 + pc(root), start: 0, duration: beats, velocity: 0.6 });
  }
  return out;
}
