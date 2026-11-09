/**
 * Musical transformations behind the AI action buttons and the assistant commands.
 * Every function is pure: Project in → Project out (so undo works by snapshot).
 * Region-aware operations only touch [from, to) unless told otherwise.
 */
import { clearRange, humanizeNotes, mapNotesInRange, scaleVelocities } from '../model/clipOps';
import { makeEffect, masteringChain } from '../model/effects';
import { newTrack, projectEndBeat, sendsForRole } from '../model/factory';
import { PRESET_MAP } from '../model/presets';
import type { Project, Section, SectionKind, Track, TrackRole } from '../model/schema';
import { uid } from '../util/id';
import { hashString, rng } from '../util/math';
import { chordSymbol, isMinorish, parseChordSymbol, scaleStep, snapToScale } from '../theory/theory';
import { writeLyrics } from './lyrics';
import { realizeChordSymbols } from './plan';
import { chordEventsFromSymbols, fillSection } from './realize';
import { GENRES, INSTRUMENT_WORDS, SECTION_DEFAULTS, MOODS } from './styles';
import { composeLocal, DEFAULT_SETTINGS } from './composer';

const bpbOf = (p: Project) => (p.timeSignature.numerator * 4) / p.timeSignature.denominator;
const HARMONIC: TrackRole[] = ['chords', 'pad', 'strings', 'arp', 'ostinato', 'bass', 'brass', 'countermelody', 'harmony', 'backing-vocal', 'woodwinds'];
const MELODIC: TrackRole[] = ['melody', 'vocal'];
const RHYTHMIC: TrackRole[] = ['drums', 'percussion', 'bass'];

export function sectionsInRange(p: Project, from: number, to: number): number[] {
  return p.sections.map((s, i) => [s, i] as const).filter(([s]) => s.start < to - 1e-6 && s.start + s.length > from + 1e-6).map(([, i]) => i);
}

function tracksByRoles(p: Project, roles: TrackRole[] | 'all', trackIds?: string[]) {
  return new Set(p.tracks.filter((t) => t.type !== 'audio' && (trackIds?.length ? trackIds.includes(t.id) : roles === 'all' || roles.includes(t.role))).map((t) => t.id));
}

/** Tracks that currently play in a section (have notes there). */
function activeIn(p: Project, s: Section): Set<string> {
  return new Set(p.tracks.filter((t) => t.clips.some((c) => c.start < s.start + s.length - 1e-6 && c.start + c.length > s.start + 1e-6 && c.notes.length)).map((t) => t.id));
}

export interface RegenOpts { roles?: TrackRole[] | 'all'; trackIds?: string[]; seed?: number; energyDelta?: number; refitMelody?: boolean; onlyActive?: boolean }

/** Regenerate parts of one or more sections, leaving everything else untouched. */
export function regenerateSections(p: Project, sectionIdx: number[], o: RegenOpts = {}): Project {
  let out = ensureStyle(p);
  const seed = o.seed ?? Math.floor(Math.random() * 1e9);
  for (const si of sectionIdx) {
    const s = out.sections[si];
    if (!s) continue;
    let ids = tracksByRoles(out, o.roles ?? 'all', o.trackIds);
    if (o.onlyActive !== false && !o.trackIds?.length) {
      const act = activeIn(out, s);
      ids = new Set([...ids].filter((id) => act.has(id)));
    }
    if (o.energyDelta) out = setSectionEnergy(out, si, s.energy + o.energyDelta);
    out = fillSection(out, si, { seed: seed + si * 101, trackIds: ids, refitMelody: o.refitMelody });
  }
  return out;
}

export function setSectionEnergy(p: Project, si: number, energy: number): Project {
  return { ...p, sections: p.sections.map((s, i) => (i === si ? { ...s, energy: Math.max(0.05, Math.min(1, energy)) } : s)) };
}

/** Make sure the project has style info (projects built by hand may not). */
export function ensureStyle(p: Project): Project {
  if (p.style) return p;
  const genre = p.generation?.genre && GENRES[p.generation.genre] ? p.generation.genre : 'pop';
  const g = GENRES[genre];
  return { ...p, style: { genre, mood: 'neutral', drums: g.drums, bass: g.bass, swing: g.swing, melodyDensity: g.melodyDensity, syncopation: g.syncopation, complexity: 0.5, creativity: 0.5, seed: 1 } };
}

/** Ensure there are sections covering the arrangement (for hand-made projects). */
export function ensureSections(p: Project): Project {
  if (p.sections.length) return p;
  const bpb = bpbOf(p);
  const end = Math.max(bpb * 8, Math.ceil(projectEndBeat(p) / bpb) * bpb);
  const secs: Section[] = [];
  for (let b = 0, i = 0; b < end; b += bpb * 8, i++) secs.push({ id: uid('s'), name: `Part ${String.fromCharCode(65 + (i % 26))}`, kind: 'custom', start: b, length: Math.min(bpb * 8, end - b), energy: 0.6, transpose: 0 });
  let chords = p.chords;
  if (!chords.length) {
    const syms = realizeChordSymbols(isMinorish(p.key.mode) ? ['i', 'VI', 'III', 'VII'] : ['I', 'V', 'vi', 'IV'], Math.round(end / bpb), p.key.tonic, p.key.mode, 3, 1, 0.4, rng(1), 'none');
    chords = chordEventsFromSymbols(syms, 0, bpb);
  }
  return { ...p, sections: secs, chords };
}

// ---------------------------------------------------------------------------------
export function improveChords(p: Project, sectionIdx: number[], seed: number): Project {
  let out = ensureStyle(ensureSections(p));
  const r = rng(seed);
  const g = GENRES[out.style!.genre] ?? GENRES.pop;
  const minor = isMinorish(out.key.mode);
  const bpb = bpbOf(out);
  for (const si of sectionIdx) {
    const s = out.sections[si];
    const pool = minor ? g.progMinor : g.progMajor;
    const bias = MOODS[out.style!.mood]?.progBias ?? [];
    const prog = r.pick([...pool, ...bias.filter(() => r.chance(0.5))].filter(Boolean));
    const bars = Math.round(s.length / bpb);
    const isLast = si === out.sections.length - 1;
    const next = out.sections[si + 1];
    const cadence = isLast ? 'full' : next && ['chorus', 'climax', 'drop'].includes(next.kind) ? 'half' : 'none';
    const syms = realizeChordSymbols(prog, bars, out.key.tonic, out.key.mode, g.chordSize, g.harmonicRhythm, Math.min(1, out.style!.complexity + 0.15), r, cadence, s.transpose);
    const events = chordEventsFromSymbols(syms, s.start, bpb);
    out = { ...out, chords: [...out.chords.filter((c) => c.start < s.start - 1e-6 || c.start >= s.start + s.length - 1e-6), ...events].sort((a, b) => a.start - b.start) };
    const act = activeIn(out, s);
    const harmonic = new Set([...tracksByRoles(out, HARMONIC)].filter((id) => act.has(id)));
    out = fillSection(out, si, { seed: seed + si, trackIds: harmonic });
    // keep the melody's rhythm/contour but fit it to the new chords
    const mel = new Set([...tracksByRoles(out, MELODIC)].filter((id) => act.has(id)));
    out = fillSection(out, si, { seed: seed + si, trackIds: mel, refitMelody: true });
  }
  return out;
}

export function improveMelody(p: Project, sectionIdx: number[], seed: number): Project {
  const out = ensureStyle(ensureSections(p));
  let melodic = out.tracks.filter((t) => MELODIC.includes(t.role)).map((t) => t.id);
  if (!melodic.length) {
    // no melody: add one
    const t = newTrack({ preset: 'sine-lead', name: 'Lead Melody', role: 'melody' }, out.tracks.length);
    t.volume = -7;
    t.sends = sendsForRole('melody', out.returns);
    out.tracks = [...out.tracks, t];
    melodic = [t.id];
  }
  // also refresh harmony/counter/brass which follow the melody
  const followers = out.tracks.filter((t) => ['harmony', 'backing-vocal', 'countermelody', 'brass'].includes(t.role)).map((t) => t.id);
  return regenerateSections(out, sectionIdx, { trackIds: [...melodic, ...followers], seed, onlyActive: false });
}

export function improveRhythm(p: Project, sectionIdx: number[], seed: number): Project {
  const out = ensureStyle(ensureSections(p));
  if (!out.tracks.some((t) => t.role === 'drums' || t.role === 'percussion')) return addInstrument(out, 'drums', seed);
  // more syncopation for this regeneration
  const st = out.style!;
  const boosted = { ...out, style: { ...st, syncopation: Math.min(1, st.syncopation + 0.15) } };
  const res = regenerateSections(boosted, sectionIdx, { roles: RHYTHMIC, seed });
  return { ...res, style: st };
}

export function createVariation(p: Project, sectionIdx: number[], seed: number): Project {
  const out = ensureStyle(ensureSections(p));
  const st = out.style!;
  const varied = { ...out, style: { ...st, creativity: Math.min(1, st.creativity + 0.25) } };
  return { ...regenerateSections(varied, sectionIdx, { roles: 'all', seed }), style: st };
}

export function changeEnergy(p: Project, sectionIdx: number[], delta: number, seed: number): Project {
  let out = ensureStyle(ensureSections(p));
  for (const si of sectionIdx) out = setSectionEnergy(out, si, out.sections[si].energy + delta);
  // regenerate everything that should play at the new energy (parts may enter/leave)
  for (const si of sectionIdx) {
    const s = out.sections[si];
    const g = GENRES[out.style!.genre] ?? GENRES.pop;
    const ids = new Set<string>();
    for (const t of out.tracks) {
      if (t.type === 'audio') continue;
      const rs = g.roles.find((x) => x.role === t.role);
      const min = rs?.minEnergy ?? 0.3;
      if (rs?.skip?.includes(s.kind)) continue;
      if (s.energy >= min - 1e-6 || ['melody', 'vocal'].includes(t.role) && activeIn(out, s).has(t.id)) ids.add(t.id);
    }
    // remove parts that no longer fit
    out = { ...out, tracks: out.tracks.map((t) => (!ids.has(t.id) && t.type !== 'audio' && activeIn(out, s).has(t.id) && delta < 0 ? clearRange(t, s.start, s.start + s.length) : t)) };
    out = fillSection(out, si, { seed: seed + si, trackIds: ids });
  }
  // track-level gain staging for intensity
  if (delta > 0) out = { ...out, tracks: out.tracks.map((t) => (t.role === 'drums' || t.role === 'bass' ? { ...t, volume: Math.min(3, t.volume + 1) } : t)) };
  return out;
}

export function softenArrangement(p: Project, sectionIdx: number[], seed: number): Project {
  let out = changeEnergy(p, sectionIdx, -0.25, seed);
  const range = sectionIdx.map((i) => out.sections[i]);
  out = {
    ...out,
    tracks: out.tracks.map((t) => {
      let tt = t;
      for (const s of range) tt = mapNotesInRange(tt, s.start, s.start + s.length, (ns) => scaleVelocities(ns, 0.8));
      return tt;
    }),
  };
  return out;
}

export function humanize(p: Project, from: number, to: number, amount: number, seed: number): Project {
  return { ...p, tracks: p.tracks.map((t, i) => mapNotesInRange(t, from, to, (ns) => humanizeNotes(ns, amount, seed + i))) };
}

/** Add an instrument by keyword/role/preset and compose its part in every section. */
export function addInstrument(p: Project, what: string, seed: number, presetOverride?: string): Project {
  const out = ensureStyle(ensureSections(p));
  const hit = INSTRUMENT_WORDS.find((w) => w.re.test(what));
  const preset = presetOverride ?? hit?.preset ?? (PRESET_MAP[what] ? what : 'string-ensemble');
  const role: TrackRole = hit?.role ?? (PRESET_MAP[preset]?.kind === 'drumkit' ? 'drums' : 'pad');
  const name = hit?.name ?? PRESET_MAP[preset]?.name ?? 'New Part';
  const t = newTrack({ preset, name, role }, out.tracks.length);
  t.volume = role === 'drums' ? -5 : role === 'melody' ? -7 : -10;
  t.pattern = hit?.comp ?? (role === 'arp' ? 'arp' : role === 'chords' ? 'block' : role === 'ostinato' ? 'ostinato' : 'pad');
  t.sends = sendsForRole(role, out.returns);
  if (out.style?.genre === 'orchestral' && role === 'drums') { t.instrument.kit = 'orchestral'; t.role = 'percussion'; }
  let res: Project = { ...out, tracks: [...out.tracks, t] };
  const g = GENRES[out.style!.genre] ?? GENRES.pop;
  const minE = role === 'melody' || role === 'brass' ? 0.5 : role === 'drums' ? 0.4 : 0.2;
  res.sections.forEach((s, si) => {
    if (s.energy + 1e-6 < minE && !['pad', 'strings', 'fx'].includes(role)) return;
    res = fillSection(res, si, { seed: seed + si, trackIds: new Set([t.id]) });
  });
  void g;
  return res;
}

export function removeInstruments(p: Project, matcher: (t: Track) => boolean): Project {
  return { ...p, tracks: p.tracks.filter((t) => !matcher(t)) };
}

export function findTracks(p: Project, what: string): Track[] {
  const w = what.toLowerCase().trim();
  const byName = p.tracks.filter((t) => t.name.toLowerCase().includes(w));
  if (byName.length) return byName;
  const hit = INSTRUMENT_WORDS.find((x) => x.re.test(w));
  if (hit) {
    const byPreset = p.tracks.filter((t) => t.instrument.preset === hit.preset);
    if (byPreset.length) return byPreset;
    return p.tracks.filter((t) => t.role === hit.role);
  }
  return p.tracks.filter((t) => t.role === (w as TrackRole));
}

/** Make the arrangement more cinematic: strings/brass/percussion/choir, hall reverb, wider dynamics. */
export function makeCinematic(p: Project, seed: number): Project {
  let out = ensureStyle(ensureSections(p));
  const want: [string, string][] = [['strings', 'string-ensemble'], ['ostinato', 'spiccato'], ['brass', 'french-horns'], ['percussion', 'kit-orchestral'], ['pad', 'synth-choir']];
  for (const [role, preset] of want) {
    if (out.tracks.some((t) => t.instrument.preset === preset || (role === 'percussion' && t.instrument.kit === 'orchestral'))) continue;
    out = addInstrument(out, role === 'percussion' ? 'taiko' : role === 'ostinato' ? 'spiccato' : role === 'pad' ? 'choir' : role, seed + preset.length, preset);
  }
  // timpani
  if (!out.tracks.some((t) => t.instrument.preset === 'timpani')) out = addInstrument(out, 'timpani', seed + 3, 'timpani');
  out = {
    ...out,
    returns: out.returns.map((r) => (r.id === 'ret-reverb' ? { ...r, effects: [makeEffect('reverb', { decay: 4.5, predelay: 0.035, size: 0.9, mix: 1, tone: 6000 })] } : r)),
    tracks: out.tracks.map((t) => ({ ...t, sends: t.sends.map((s) => (s.returnId === 'ret-reverb' ? { ...s, level: Math.min(1, s.level * 1.4 + 0.05) } : s)) })),
    master: { ...out.master, effects: masteringChain('cinematic'), preset: 'cinematic' },
  };
  // swap electronic drums for orchestral percussion
  out = { ...out, tracks: out.tracks.map((t) => (t.type === 'drums' && t.instrument.kit !== 'orchestral' ? { ...t, volume: t.volume - 6 } : t)) };
  return out;
}

/** Change genre: re-plan style while keeping key, sections and harmony; regenerate all parts. */
export function changeGenre(p: Project, genre: string, seed: number): Project {
  const g = GENRES[genre];
  if (!g) return p;
  // compose a fresh song in the new genre but transplant the form and chords
  const fresh = composeLocal({ ...(p.generation ?? DEFAULT_SETTINGS), genre, prompt: p.generation?.prompt ?? genre, seed, key: `${['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][p.key.tonic]} ${p.key.mode}` }).project;
  let out: Project = {
    ...fresh,
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    sections: p.sections.length ? p.sections : fresh.sections,
    chords: p.chords.length ? p.chords : fresh.chords,
    lyrics: p.lyrics,
    tempoChanges: [],
    bpm: Math.max(g.bpm[0], Math.min(g.bpm[1], p.bpm)),
    tracks: fresh.tracks.map((t) => ({ ...t, clips: [] })),
  };
  // keep any audio tracks the user recorded
  out.tracks = [...out.tracks, ...p.tracks.filter((t) => t.type === 'audio')];
  out.sections.forEach((s, si) => {
    const ids = new Set(out.tracks.filter((t) => t.type !== 'audio' && (s.energy >= (g.roles.find((x) => x.role === t.role)?.minEnergy ?? 0) - 1e-6) && !(g.roles.find((x) => x.role === t.role)?.skip ?? []).includes(s.kind)).map((t) => t.id));
    out = fillSection(out, si, { seed: seed + si, trackIds: ids });
  });
  return { ...out, generation: { ...(p.generation ?? DEFAULT_SETTINGS), genre } };
}

/** Remix: new tempo feel, re-orchestrated parts, same chords & melody. */
export function remix(p: Project, seed: number): Project {
  const out = ensureStyle(ensureSections(p));
  const r = rng(seed);
  const options = ['edm', 'house', 'lofi', 'synthwave', 'trap', 'dnb', 'funk', 'orchestral', 'pop'].filter((g) => g !== out.style!.genre);
  const g = r.pick(options);
  const res = changeGenre(out, g, seed);
  // keep the original melody notes (transplant melodic clips)
  const mel = p.tracks.filter((t) => MELODIC.includes(t.role));
  return { ...res, name: `${p.name} (${GENRES[g].label} remix)`, tracks: res.tracks.map((t) => { const src = mel.find((m) => m.role === t.role); return src ? { ...t, clips: src.clips } : t; }) };
}

/** Extend the song by appending sections (default: another chorus/climax and an outro). */
export function extendSong(p: Project, bars: number, seed: number, kinds?: SectionKind[]): Project {
  let out = ensureStyle(ensureSections(p));
  const bpb = bpbOf(out);
  const lastIsEnding = ['outro', 'coda'].includes(out.sections[out.sections.length - 1]?.kind);
  let insertAt = lastIsEnding ? out.sections.length - 1 : out.sections.length;
  const startBeat = out.sections[insertAt]?.start ?? out.sections.reduce((m, s) => Math.max(m, s.start + s.length), 0);
  const big = [...out.sections].reverse().find((s) => ['chorus', 'climax', 'drop', 'theme'].includes(s.kind));
  const plan: SectionKind[] = kinds ?? (big ? [big.kind] : ['custom']);
  const total = Math.max(bpb, bars * bpb);
  const per = Math.max(1, Math.round(total / plan.length / bpb)) * bpb;
  // shift everything after the insertion point
  const shift = per * plan.length;
  out = shiftAfter(out, startBeat, shift);
  const newSecs: Section[] = plan.map((k, i) => ({ id: uid('s'), name: `${k[0].toUpperCase()}${k.slice(1)} (ext ${i + 1})`, kind: k, start: startBeat + i * per, length: per, energy: big?.energy ?? SECTION_DEFAULTS[k].energy, transpose: 0 }));
  // chords: copy from the reference section when it exists
  const newChords = newSecs.flatMap((s) => {
    const ref = out.sections.find((x) => x.kind === s.kind);
    if (!ref) return chordEventsFromSymbols(realizeChordSymbols(isMinorish(out.key.mode) ? ['i', 'VI', 'III', 'VII'] : ['I', 'V', 'vi', 'IV'], Math.round(s.length / bpb), out.key.tonic, out.key.mode, 3, 1, 0.4, rng(seed), 'none'), s.start, bpb);
    const src = out.chords.filter((c) => c.start >= ref.start && c.start < ref.start + ref.length);
    const res = [];
    for (let off = 0; off < s.length; off += ref.length) for (const c of src) if (c.start - ref.start + off < s.length) res.push({ ...c, start: s.start + off + (c.start - ref.start) });
    return res;
  });
  out = { ...out, sections: [...out.sections.slice(0, insertAt), ...newSecs, ...out.sections.slice(insertAt)], chords: [...out.chords, ...newChords].sort((a, b) => a.start - b.start) };
  for (let i = 0; i < newSecs.length; i++) {
    const si = insertAt + i;
    const ref = p.sections.find((x) => x.kind === newSecs[i].kind);
    const ids = ref ? activeIn(p, ref) : new Set(out.tracks.map((t) => t.id));
    out = fillSection(out, si, { seed: seed + i, trackIds: ids });
  }
  insertAt += newSecs.length;
  return out;
}

function shiftAfter(p: Project, at: number, by: number): Project {
  return {
    ...p,
    sections: p.sections.map((s) => (s.start >= at - 1e-6 ? { ...s, start: s.start + by } : s)),
    chords: p.chords.map((c) => (c.start >= at - 1e-6 ? { ...c, start: c.start + by } : c)),
    markers: p.markers.map((m) => (m.beat >= at - 1e-6 ? { ...m, beat: m.beat + by } : m)),
    tempoChanges: p.tempoChanges.map((t) => (t.beat >= at - 1e-6 ? { ...t, beat: t.beat + by } : t)),
    tracks: p.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => (c.start >= at - 1e-6 ? { ...c, start: c.start + by } : c)),
      automation: t.automation.map((a) => ({ ...a, points: a.points.map((pt) => (pt.beat >= at - 1e-6 ? { ...pt, beat: pt.beat + by } : pt)) })),
    })),
  };
}

/** Replace the intro or ending section with a newly composed one. */
export function newIntroOrEnding(p: Project, which: 'intro' | 'outro', seed: number): Project {
  let out = ensureStyle(ensureSections(p));
  const bpb = bpbOf(out);
  const idx = which === 'intro' ? out.sections.findIndex((s) => s.kind === 'intro') : out.sections.map((s) => s.kind).lastIndexOf('outro') >= 0 ? out.sections.map((s) => s.kind).lastIndexOf('outro') : out.sections.findIndex((s) => s.kind === 'coda');
  if (idx < 0) {
    // create one
    const len = 4 * bpb;
    if (which === 'intro') {
      out = shiftAfter(out, 0, len);
      const ref = out.sections[0];
      const sec: Section = { id: uid('s'), name: 'Intro', kind: 'intro', start: 0, length: len, energy: 0.35, transpose: 0 };
      const refChords = out.chords.filter((c) => c.start >= ref.start && c.start < ref.start + len).map((c) => ({ ...c, start: c.start - ref.start }));
      out = { ...out, sections: [sec, ...out.sections], chords: [...refChords, ...out.chords] };
      return fillSection(out, 0, { seed, trackIds: new Set(out.tracks.filter((t) => ['pad', 'strings', 'chords', 'arp', 'fx', 'bass'].includes(t.role)).map((t) => t.id)) });
    }
    return extendSong(out, 4, seed, ['outro']);
  }
  const s = out.sections[idx];
  const r = rng(seed);
  out = setSectionEnergy(out, idx, which === 'intro' ? r.float(0.25, 0.5) : r.float(0.3, 0.6));
  if (which === 'outro') {
    // end on the tonic with a real cadence
    const bars = Math.round(s.length / bpb);
    const syms = realizeChordSymbols(isMinorish(out.key.mode) ? r.pick([['iv', 'VI', 'VII', 'i'], ['VI', 'VII', 'i', 'i']]) : r.pick([['IV', 'V', 'I', 'I'], ['vi', 'IV', 'V', 'I'], ['IV', 'iv', 'I', 'I']]), bars, out.key.tonic, out.key.mode, 3, 1, 0.4, r, 'full');
    out = { ...out, chords: [...out.chords.filter((c) => c.start < s.start - 1e-6 || c.start >= s.start + s.length), ...chordEventsFromSymbols(syms, s.start, bpb)].sort((a, b) => a.start - b.start) };
  }
  const roles: TrackRole[] = which === 'intro' ? ['pad', 'strings', 'chords', 'arp', 'fx', 'melody', 'bass'] : ['pad', 'strings', 'chords', 'arp', 'melody', 'bass', 'drums', 'percussion', 'brass'];
  const ids = new Set(out.tracks.filter((t) => roles.includes(t.role)).map((t) => t.id));
  out = { ...out, tracks: out.tracks.map((t) => (t.type !== 'audio' ? clearRange(t, s.start, s.start + s.length) : t)) };
  return fillSection(out, idx, { seed, trackIds: ids });
}

/** Add a harmony line (diatonic third) following the lead. */
export function generateHarmonies(p: Project, sectionIdx: number[], seed: number): Project {
  let out = ensureStyle(ensureSections(p));
  let h = out.tracks.find((t) => t.role === 'harmony' || t.role === 'backing-vocal');
  if (!h) {
    const lead = out.tracks.find((t) => t.role === 'vocal') ?? out.tracks.find((t) => t.role === 'melody');
    const preset = lead?.role === 'vocal' ? 'synth-choir' : lead?.instrument.preset ?? 'string-ensemble';
    h = newTrack({ preset, name: lead?.role === 'vocal' ? 'Harmony Vocals – guide' : 'Harmony', role: lead?.role === 'vocal' ? 'backing-vocal' : 'harmony' }, out.tracks.length);
    h.volume = (lead?.volume ?? -6) - 5;
    h.pan = -0.2;
    h.sends = sendsForRole('harmony', out.returns);
    out = { ...out, tracks: [...out.tracks, h] };
  }
  const id = h.id;
  for (const si of sectionIdx) out = fillSection(out, si, { seed: seed + si, trackIds: new Set([id]) });
  return out;
}

/** Transpose the whole song (notes, chords, key). Drum tracks are left alone. */
export function transposeSong(p: Project, semis: number, from = 0, to = Infinity): Project {
  const whole = from <= 0 && to === Infinity;
  return {
    ...p,
    key: whole ? { ...p.key, tonic: (((p.key.tonic + semis) % 12) + 12) % 12 } : p.key,
    chords: p.chords.map((c) => (c.start >= from && c.start < to ? { ...c, root: (c.root + semis + 120) % 12, bass: c.bass === null ? null : (c.bass + semis + 120) % 12, symbol: chordSymbol({ root: (c.root + semis + 120) % 12, quality: c.quality, bass: c.bass === null ? null : (c.bass + semis + 120) % 12 }) } : c)),
    tracks: p.tracks.map((t) => (t.type === 'drums' ? t : mapNotesInRange(t, from, to, (ns) => ns.map((n) => ({ ...n, pitch: Math.max(0, Math.min(127, n.pitch + semis)) }))))),
  };
}

/** Rewrite chords from user-typed symbols for a section (e.g. "Am F C G"). */
export function setSectionChords(p: Project, si: number, symbols: string[], seed: number): Project {
  const s = p.sections[si];
  if (!s) return p;
  const bpb = bpbOf(p);
  const valid = symbols.filter((x) => parseChordSymbol(x));
  if (!valid.length) return p;
  const bars = Math.round(s.length / bpb);
  const syms = Array.from({ length: bars }, (_, i) => valid[i % valid.length]);
  let out = { ...p, chords: [...p.chords.filter((c) => c.start < s.start - 1e-6 || c.start >= s.start + s.length - 1e-6), ...chordEventsFromSymbols(syms, s.start, bpb)].sort((a, b) => a.start - b.start) };
  const act = activeIn(out, s);
  out = fillSection(ensureStyle(out), si, { seed, trackIds: new Set([...tracksByRoles(out, HARMONIC)].filter((id) => act.has(id))) });
  return fillSection(out, si, { seed, trackIds: new Set([...tracksByRoles(out, MELODIC)].filter((id) => act.has(id))), refitMelody: true });
}

/** Generate lyrics locally for sections that have vocals. */
export function writeLocalLyrics(p: Project, topic: string, seed: number): Project {
  const vocal = p.tracks.find((t) => t.role === 'vocal');
  const secs = p.sections.filter((s) => !vocal || vocal.clips.some((c) => c.sectionId === s.id) || ['verse', 'chorus', 'prechorus', 'bridge'].includes(s.kind));
  const bpb = bpbOf(p);
  return {
    ...p,
    lyrics: {
      ...p.lyrics,
      sections: secs.map((s, i) => ({ id: uid('l'), label: s.name, sectionId: s.id, text: writeLyrics(s.kind, p.style?.mood ?? 'neutral', Math.max(2, Math.floor(s.length / bpb / 2)), seed + i * 13 + hashString(s.kind), topic) })),
    },
  };
}

/** Re-align the vocal melody to the current lyrics (one note per syllable). */
export function alignVocals(p: Project, seed: number): Project {
  const vocal = p.tracks.find((t) => t.role === 'vocal');
  if (!vocal) return p;
  let out = ensureStyle(ensureSections(p));
  out.sections.forEach((s, si) => {
    if (!out.lyrics.sections.some((l) => l.sectionId === s.id || l.label === s.name)) return;
    out = fillSection(out, si, { seed: seed + si, trackIds: new Set([vocal.id]) });
  });
  return out;
}

/** Simple melodic transform helpers exposed to the assistant. */
export function invertMelody(p: Project, trackId: string, from: number, to: number): Project {
  return {
    ...p,
    tracks: p.tracks.map((t) => (t.id !== trackId ? t : mapNotesInRange(t, from, to, (ns) => {
      if (!ns.length) return ns;
      const axis = ns[0].pitch;
      return ns.map((n) => ({ ...n, pitch: snapToScale(axis - (n.pitch - axis), p.key.tonic, p.key.mode) }));
    }))),
  };
}
export function octaveDouble(p: Project, trackId: string, from: number, to: number, octaves = 1): Project {
  return {
    ...p,
    tracks: p.tracks.map((t) => (t.id !== trackId ? t : mapNotesInRange(t, from, to, (ns) => [...ns, ...ns.map((n) => ({ ...n, id: uid('n'), pitch: Math.max(0, Math.min(127, n.pitch + 12 * octaves)), velocity: n.velocity * 0.8 }))]))),
  };
}
export function stepShift(p: Project, trackId: string, from: number, to: number, steps: number): Project {
  return { ...p, tracks: p.tracks.map((t) => (t.id !== trackId ? t : mapNotesInRange(t, from, to, (ns) => ns.map((n) => ({ ...n, pitch: scaleStep(n.pitch, steps, p.key.tonic, p.key.mode) }))))) };
}
