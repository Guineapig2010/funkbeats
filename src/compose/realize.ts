/**
 * Realizer: CompositionSpec → Project. Also exposes `fillSection`, used to
 * (re)generate any subset of parts for one section without touching the rest.
 */
import { clearRange } from '../model/clipOps';
import { makeEffect, masteringChain } from '../model/effects';
import { newMidiClip, newNote, newProject, newTrack, sendsForRole } from '../model/factory';
import { PRESET_MAP } from '../model/presets';
import type { ChordEvent, Note, Project, Section, Track, TrackRole } from '../model/schema';
import { uid } from '../util/id';
import { hashString, rng } from '../util/math';
import { chordSymbol, parseChordSymbol, parseNoteName, pc } from '../theory/theory';
import { lineSyllables } from './lyrics';
import {
  composeBass, composeBrass, composeComp, composeCounter, composeDrums, composeFx, composeMelody, composeVocal, harmonize, isHigh,
  refitTheme, varyTheme, type ChordSpan, type PartContext, type PNote,
} from './parts';
import type { CompositionSpec } from './spec';
import { GENRES, type BassStyle, type CompStyle, type DrumStyle } from './styles';

const ROLE_VOLUME: Partial<Record<TrackRole, number>> = {
  drums: -4, percussion: -3, bass: -5, chords: -9, pad: -12, melody: -6, vocal: -5, arp: -15, strings: -9, brass: -8,
  countermelody: -10, ostinato: -10, fx: -10, harmony: -11, 'backing-vocal': -12, woodwinds: -9, other: -8,
};
const ROLE_PAN: Partial<Record<TrackRole, number>> = { arp: 0.3, countermelody: -0.3, ostinato: 0.2, brass: -0.2, woodwinds: 0.25, harmony: -0.2, 'backing-vocal': 0.25, chords: -0.1, strings: 0.1 };
const DEFAULT_COMP: Partial<Record<TrackRole, CompStyle>> = { chords: 'block', pad: 'pad', strings: 'pad', arp: 'arp', ostinato: 'ostinato' };

export function roleRange(track: Track, voice: 'any' | 'male' | 'female' | 'choir' = 'any'): [number, number] {
  const pr = PRESET_MAP[track.instrument.preset]?.range ?? [36, 96];
  const win: Partial<Record<TrackRole, [number, number]>> = {
    melody: [60, 84], vocal: voice === 'male' ? [48, 69] : voice === 'female' ? [57, 79] : [53, 74], 'backing-vocal': [50, 72], harmony: [55, 79],
    countermelody: [48, 72], bass: [28, 52], brass: [46, 74], woodwinds: [60, 88],
  };
  const w = win[track.role] ?? pr;
  const lo = Math.max(pr[0], w[0]), hi = Math.min(pr[1], w[1]);
  return hi - lo >= 10 ? [lo, hi] : [w[0], w[1]];
}

function compCenter(track: Track): number {
  const pr = PRESET_MAP[track.instrument.preset]?.range ?? [48, 84];
  const base: Partial<Record<TrackRole, number>> = { chords: 60, pad: 62, strings: 62, arp: 67, ostinato: 55 };
  const c = base[track.role] ?? 60;
  return Math.max(pr[0] + 6, Math.min(pr[1] - 8, c));
}

export function chordsInRange(chords: ChordEvent[], start: number, end: number): ChordSpan[] {
  const spans: ChordSpan[] = [];
  for (const c of chords) {
    if (c.start >= end - 1e-6 || c.start + c.length <= start + 1e-6) continue;
    spans.push({ start: Math.max(0, c.start - start), end: Math.min(end, c.start + c.length) - start, chord: { root: c.root, quality: c.quality, bass: c.bass } });
  }
  return spans.sort((a, b) => a.start - b.start);
}

export function chordEventsFromSymbols(bars: string[], startBeat: number, bpb: number): ChordEvent[] {
  const out: ChordEvent[] = [];
  bars.forEach((bar, i) => {
    const parts = bar.split(/\s+/).filter(Boolean);
    const len = bpb / Math.max(1, parts.length);
    parts.forEach((sym, j) => {
      const ch = parseChordSymbol(sym) ?? { root: 0, quality: 'maj', bass: null };
      out.push({ start: startBeat + i * bpb + j * len, length: len, root: ch.root, quality: ch.quality, bass: ch.bass, symbol: chordSymbol(ch, sym.includes('b')) });
    });
  });
  // merge repeated chords
  const merged: ChordEvent[] = [];
  for (const c of out) {
    const last = merged[merged.length - 1];
    if (last && last.symbol === c.symbol && Math.abs(last.start + last.length - c.start) < 1e-6 && last.length < bpb * 2) last.length += c.length;
    else merged.push({ ...c });
  }
  return merged;
}

function trackEffects(tags: string[], role: TrackRole, drumsTrackId: string | null) {
  const fx = [];
  for (const t of tags) {
    if (t === 'guitar') fx.push(makeEffect('distortion', { drive: 0.5, tone: 3800, output: -10, curve: 'soft' }), makeEffect('eq', { hpf: 90, mid1Freq: 400, mid1Gain: -3, mid2Freq: 2500, mid2Gain: 2 }));
    if (t === 'metal-guitar') fx.push(makeEffect('distortion', { drive: 0.8, tone: 4200, output: -14, curve: 'hard' }), makeEffect('eq', { hpf: 100, mid1Freq: 600, mid1Gain: -5, mid2Freq: 3000, mid2Gain: 2, lowFreq: 120, lowGain: 2 }));
    if (t === 'lead-guitar') fx.push(makeEffect('distortion', { drive: 0.65, tone: 3500, output: -12, curve: 'soft' }), makeEffect('delay', { time: 0.75, feedback: 0.3, mix: 0.18 }));
    if (t === 'pump' && drumsTrackId) fx.push(makeEffect('ducking', { source: drumsTrackId, depth: 0.7, release: 0.22, triggerPitch: 36 }));
    if (t === 'lofi') fx.push(makeEffect('bitcrush', { bits: 9, tone: 7000, mix: 0.35 }), makeEffect('filter', { mode: 'lowpass', cutoff: 7500, resonance: 0.7 }));
    if (t === 'lofi-keys') fx.push(makeEffect('saturation', { drive: 5, warmth: 0.6 }), makeEffect('chorus', { rate: 0.4, depth: 0.0025, mix: 0.3 }), makeEffect('filter', { mode: 'lowpass', cutoff: 5000, resonance: 0.6 }));
    if (t === 'gated') fx.push(makeEffect('compressor', { threshold: -16, ratio: 4, attack: 0.003, release: 0.08, makeup: 3 }));
    if (t === 'chorus') fx.push(makeEffect('chorus', { rate: 0.6, depth: 0.003, mix: 0.4 }));
    if (t === 'delay') fx.push(makeEffect('delay', { time: 0.75, feedback: 0.35, mix: 0.2 }));
  }
  if (role === 'bass' && !fx.length) fx.push(makeEffect('compressor', { threshold: -22, ratio: 4, attack: 0.008, release: 0.12, makeup: 3 }));
  if (role === 'drums' && !tags.includes('lofi')) fx.push(makeEffect('compressor', { threshold: -14, ratio: 2.5, attack: 0.015, release: 0.14, makeup: 2, mix: 0.75 }));
  if (role === 'vocal') fx.push(makeEffect('eq', { hpf: 100, mid2Freq: 3500, mid2Gain: 2.5 }), makeEffect('compressor', { threshold: -20, ratio: 3, attack: 0.005, release: 0.12, makeup: 3 }));
  return fx;
}

export interface FillOptions {
  seed: number;
  /** Track ids to (re)generate. */
  trackIds: Set<string>;
  themes?: Map<string, PNote[]>;
  /** Keep the existing melody rhythm and refit to (new) chords instead of composing new. */
  refitMelody?: boolean;
  energyOverride?: number;
}

function sectionCtx(p: Project, si: number, seed: number, salt: string, energy?: number): PartContext {
  const s = p.sections[si];
  const bpb = (p.timeSignature.numerator * 4) / p.timeSignature.denominator;
  const st = p.style;
  return {
    r: rng((seed ^ hashString(salt)) >>> 0),
    bars: Math.max(1, Math.round(s.length / bpb)),
    bpb,
    chords: chordsInRange(p.chords, s.start, s.start + s.length),
    tonic: pc(p.key.tonic + (s.transpose ?? 0)),
    mode: p.key.mode,
    energy: energy ?? s.energy,
    kind: s.kind,
    density: st?.melodyDensity ?? 0.5,
    syncopation: st?.syncopation ?? 0.3,
    complexity: st?.complexity ?? 0.5,
    creativity: st?.creativity ?? 0.5,
    center: 60,
    prevKind: p.sections[si - 1]?.kind ?? null,
    nextKind: p.sections[si + 1]?.kind ?? null,
    nextEnergy: p.sections[si + 1]?.energy ?? 0,
    prevEnergy: p.sections[si - 1]?.energy ?? 0,
    isFirst: si === 0,
    isLast: si === p.sections.length - 1,
    bpm: p.bpm,
  };
}

function toNotes(pn: PNote[]): Note[] {
  return pn.map((n) => newNote(n.pitch, n.start, n.duration, n.velocity, n.lyric));
}

function existingNotes(track: Track | undefined, s: Section): PNote[] {
  if (!track) return [];
  const out: PNote[] = [];
  for (const c of track.clips) {
    if (c.kind !== 'midi' || c.start >= s.start + s.length || c.start + c.length <= s.start) continue;
    for (const n of c.notes) {
      const abs = c.start + n.start - c.offset;
      if (abs >= s.start - 1e-6 && abs < s.start + s.length - 1e-6) out.push({ pitch: n.pitch, start: abs - s.start, duration: n.duration, velocity: n.velocity, lyric: n.lyric });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Lyrics for a section split into syllable lines. */
function lyricLines(p: Project, s: Section): string[][] {
  const ls = p.lyrics.sections.find((l) => l.sectionId === s.id) ?? p.lyrics.sections.find((l) => l.label === s.name);
  if (!ls) return [];
  return ls.text.split('\n').map((l) => l.trim()).filter(Boolean).map(lineSyllables);
}

/**
 * Generate parts for the given tracks in section `si`. Order matters: melody-type parts
 * first so that brass, harmony and counter-lines can follow them.
 */
export function fillSection(p: Project, si: number, opts: FillOptions): Project {
  const s = p.sections[si];
  const st = p.style;
  const themes = opts.themes ?? new Map<string, PNote[]>();
  const order: TrackRole[] = ['vocal', 'melody', 'harmony', 'backing-vocal', 'countermelody', 'brass', 'woodwinds', 'chords', 'pad', 'strings', 'arp', 'ostinato', 'bass', 'drums', 'percussion', 'fx', 'other', 'audio'];
  const tracks = [...p.tracks].filter((t) => opts.trackIds.has(t.id) && t.type !== 'audio').sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  const generated = new Map<string, PNote[]>();
  const leadOf = () => {
    const v = p.tracks.find((t) => t.role === 'vocal');
    const m = p.tracks.find((t) => t.role === 'melody');
    for (const t of [v, m]) {
      if (!t) continue;
      const g = generated.get(t.id) ?? existingNotes(t, s);
      if (g.length) return g;
    }
    return null;
  };
  const voice = p.lyrics.vocalStyle.voice;
  for (const t of tracks) {
    const c = sectionCtx(p, si, opts.seed, `${t.name}|${t.role}|${s.name}|${si}`, opts.energyOverride);
    const range = roleRange(t, voice);
    let notes: PNote[] = [];
    const presetId = t.instrument.preset;
    const comp = (t.pattern as CompStyle | null) ?? DEFAULT_COMP[t.role] ?? 'pad';
    switch (t.role) {
      case 'melody': case 'woodwinds': {
        if (t.role === 'woodwinds' && !(c.energy > 0.8)) { notes = composeComp(c, 'arp', compCenter(t) + 5, 3).map((n) => ({ ...n, velocity: n.velocity * 0.85 })); break; }
        const themeKind = s.kind === 'climax' && themes.has(`${t.id}:theme`) ? 'theme' : s.kind === 'postchorus' ? 'chorus' : s.kind;
        const key = `${t.id}:${themeKind}`;
        if (opts.refitMelody) {
          notes = refitTheme(existingNotes(t, s), c, range);
        } else if (themes.has(key) && s.kind !== 'solo') {
          const theme = themes.get(key)!;
          const presetHi = PRESET_MAP[presetId]?.range[1] ?? 96;
          const maxP = theme.reduce((m, n) => Math.max(m, n.pitch), 0);
          const lift = s.kind === 'climax' && maxP + 12 <= presetHi ? 12 : 0;
          notes = varyTheme(refitTheme(theme, c, [range[0] + lift, range[1] + lift], lift), c, c.creativity * 0.6);
        } else {
          notes = composeMelody(c, { range, lift: isHigh(s.kind) ? 3 : 0, sparse: s.kind === 'intro' || s.kind === 'outro' || s.kind === 'breakdown' });
          themes.set(key, notes);
        }
        break;
      }
      case 'vocal': {
        const key = `${t.id}:${s.kind}`;
        const lines = lyricLines(p, s);
        if (opts.refitMelody) notes = refitTheme(existingNotes(t, s), c, range);
        else if (themes.has(key) && !lines.length) notes = refitTheme(themes.get(key)!, c, range);
        else { notes = composeVocal(c, lines, range); themes.set(key, notes); }
        break;
      }
      case 'harmony': case 'backing-vocal': {
        const lead = leadOf();
        notes = lead ? harmonize(lead, c, t.role === 'harmony' ? 'third-above' : 'third-below') : composeComp(c, 'pad', compCenter(t), 3);
        break;
      }
      case 'countermelody': {
        const lead = leadOf() ?? [];
        notes = composeCounter(c, lead, range);
        break;
      }
      case 'brass': {
        notes = composeBrass(c, isHigh(s.kind) ? leadOf() : null, range);
        break;
      }
      case 'chords': case 'pad': case 'strings': case 'arp': case 'ostinato': case 'other': {
        notes = composeComp(c, comp, compCenter(t), t.role === 'pad' || t.role === 'strings' ? 4 : 4);
        break;
      }
      case 'bass': {
        const style = (st?.bass as BassStyle) ?? 'root-eighths';
        const bassStyle = presetId === 'orch-basses' || presetId === 'drone' ? 'sustain' : style;
        notes = composeBass(c, s.kind === 'intro' && c.energy < 0.45 ? 'sustain' : bassStyle, Math.round((range[0] + range[1]) / 2) - 2);
        break;
      }
      case 'drums': case 'percussion': {
        const style = t.instrument.kit === 'orchestral' ? 'orchestral' : ((st?.drums as DrumStyle) ?? 'backbeat');
        const humanize = ['edm', 'house', 'trap', 'dnb', 'synthwave'].includes(st?.genre ?? '') ? 0.2 : 1;
        notes = composeDrums(c, style === 'none' ? 'ambient-perc' : style, { humanize });
        break;
      }
      case 'fx': {
        if (presetId === 'rain-ambience' || presetId === 'drone') continue; // whole-song beds handled separately
        notes = composeFx(c, presetId);
        break;
      }
      default:
        continue;
    }
    generated.set(t.id, notes);
  }
  // write clips
  const tracksOut = p.tracks.map((t) => {
    if (!opts.trackIds.has(t.id) || t.type === 'audio') return t;
    const pn = generated.get(t.id);
    if (pn === undefined) return t;
    const cleared = clearRange(t, s.start, s.start + s.length);
    if (!pn.length) return cleared;
    const clip = newMidiClip(s.start, s.length, toNotes(pn), s.name, s.id);
    clip.swing = st?.swing ?? 0;
    return { ...cleared, clips: [...cleared.clips, clip].sort((a, b) => a.start - b.start) };
  });
  return { ...p, tracks: tracksOut };
}

function buildBeds(p: Project): Project {
  const end = p.sections.reduce((m, s) => Math.max(m, s.start + s.length), 0);
  return {
    ...p,
    tracks: p.tracks.map((t) => {
      if (t.role !== 'fx' || !['rain-ambience', 'drone'].includes(t.instrument.preset)) return t;
      const pitch = t.instrument.preset === 'drone' ? 36 + p.key.tonic : 66;
      return { ...t, clips: [newMidiClip(0, end, [newNote(pitch, 0, end, 0.7)], t.name)] };
    }),
  };
}

/** Build a complete project from a validated spec. */
export function realizeSpec(spec: CompositionSpec, title: string): Project {
  let p = newProject(title || spec.title || 'Generated Song');
  p.bpm = spec.bpm;
  p.timeSignature = { numerator: spec.timeSignature.numerator, denominator: spec.timeSignature.denominator };
  p.key = { tonic: spec.key.tonic, mode: spec.key.mode };
  p.master = { volume: 0, effects: masteringChain(spec.mastering), preset: spec.mastering };
  p.style = { genre: spec.genre, mood: spec.mood, drums: spec.drums, bass: spec.bass, swing: spec.swing, melodyDensity: spec.melodyDensity, syncopation: spec.syncopation, complexity: spec.complexity, creativity: spec.creativity, seed: spec.seed };
  const bpb = (spec.timeSignature.numerator * 4) / spec.timeSignature.denominator;
  // sections + chords
  let beat = 0;
  const sections: Section[] = [];
  const chords: ChordEvent[] = [];
  for (const s of spec.sections) {
    const sec: Section = { id: uid('s'), name: s.name, kind: s.kind, start: beat, length: s.bars * bpb, energy: s.energy, transpose: s.transpose ?? 0 };
    sections.push(sec);
    let syms = s.chords.length ? s.chords.slice(0, s.bars) : [];
    while (syms.length < s.bars) syms.push(syms.length ? syms[syms.length % Math.max(1, s.chords.length)] ?? syms[0] : ['C', 'Am', 'F', 'G'][syms.length % 4]);
    chords.push(...chordEventsFromSymbols(syms, beat, bpb));
    beat += s.bars * bpb;
  }
  p.sections = sections;
  p.chords = chords;
  // tracks
  const style = GENRES[spec.genre];
  const reverbScale = style?.reverb ?? 0.7;
  const tracks: Track[] = spec.tracks.map((st, i) => {
    const t = newTrack({ preset: st.preset, name: st.name, role: st.role }, i);
    const patternAdj = st.comp === 'stabs' || st.comp === 'offbeat' ? 5 : 0;
    const presetAdj: Record<string, number> = { 'orch-basses': -4, drone: -4, 'rain-ambience': -6, 'noise-riser': -2 };
    t.volume = st.volume ?? (ROLE_VOLUME[st.role] ?? -8) + patternAdj + (presetAdj[st.preset] ?? 0);
    t.pan = st.pan ?? ROLE_PAN[st.role] ?? 0;
    t.pattern = st.comp ?? DEFAULT_COMP[st.role] ?? null;
    t.sends = sendsForRole(st.role, p.returns).map((x) => ({ ...x, level: Math.min(1, x.level * reverbScale) }));
    if (st.role === 'vocal') t.instrument.params.maxVoices = 1;
    return t;
  });
  const drumsId = tracks.find((t) => t.role === 'drums')?.id ?? tracks.find((t) => t.role === 'percussion')?.id ?? null;
  spec.tracks.forEach((st, i) => { tracks[i].effects = trackEffects(st.effects, st.role, drumsId); });
  p.tracks = tracks;
  // lyrics
  p.lyrics = {
    sections: spec.lyrics.map((l) => ({ id: uid('l'), label: l.section, text: l.text, sectionId: sections.find((s) => s.name === l.section)?.id ?? null })),
    vocalStyle: spec.vocalStyle ?? { voice: 'any', delivery: 'natural' },
  };
  // fill all sections
  const themes = new Map<string, PNote[]>();
  spec.sections.forEach((s, si) => {
    const ids = new Set(tracks.filter((t) => s.roles.length === 0 || s.roles.includes(t.role)).map((t) => t.id));
    p = fillSection(p, si, { seed: spec.seed, trackIds: ids, themes });
  });
  p = buildBeds(p);
  // explicit parts (e.g. written by Claude) override generated notes
  for (const part of spec.parts) {
    const t = p.tracks.find((x) => x.name === part.track);
    const s = p.sections.find((x) => x.name === part.section);
    if (!t || !s) continue;
    const notes = part.notes.map((n) => {
      const pitch = typeof n.pitch === 'number' ? n.pitch : parseNoteName(n.pitch) ?? 60;
      return newNote(pitch, n.start, n.duration, n.velocity, n.lyric);
    }).filter((n) => n.start < s.length);
    const cleared = clearRange(t, s.start, s.start + s.length);
    const clip = newMidiClip(s.start, s.length, notes, s.name, s.id);
    p = { ...p, tracks: p.tracks.map((x) => (x.id === t.id ? { ...cleared, clips: [...cleared.clips, clip].sort((a, b) => a.start - b.start) } : x)) };
  }
  // dynamics automation: crescendo strings/pads through build-ups
  p = {
    ...p,
    tracks: p.tracks.map((t) => {
      if (!['strings', 'pad', 'brass', 'ostinato'].includes(t.role)) return t;
      const pts: { beat: number; value: number }[] = [];
      for (const s of p.sections) if (s.kind === 'buildup') pts.push({ beat: s.start, value: t.volume - 9 }, { beat: s.start + s.length - 0.01, value: t.volume + 1 }, { beat: s.start + s.length, value: t.volume });
      if (!pts.length) return t;
      return { ...t, automation: [{ id: uid('au'), target: 'volume', enabled: true, points: [{ beat: 0, value: t.volume }, ...pts] }] };
    }),
  };
  // ending: ritardando over the last two bars
  if (spec.ritardando && sections.length) {
    const end = beat;
    p.tempoChanges = [
      { beat: Math.max(0, end - 2 * bpb), bpm: Math.round(spec.bpm * 0.94) },
      { beat: Math.max(0, end - bpb), bpm: Math.round(spec.bpm * 0.84) },
      { beat: Math.max(0, end - bpb / 2), bpm: Math.round(spec.bpm * 0.72) },
    ].filter((x) => x.beat > 0);
  }
  // key change markers
  p.markers = sections.filter((s) => s.transpose).map((s) => ({ id: uid('m'), beat: s.start, name: `Key change ${s.transpose > 0 ? '+' : ''}${s.transpose}`, color: '#ffc23d' }));
  // loop the first big section for convenience
  const big = sections.find((s) => isHigh(s.kind)) ?? sections[0];
  p.loop = { enabled: false, start: big.start, end: big.start + big.length };
  p.notes = spec.notes;
  return p;
}
