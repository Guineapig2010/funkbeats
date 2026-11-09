/**
 * Arrangement planner: turns a Brief (from the prompt + controls) into a
 * CompositionSpec — tempo, key, song form fitted to the requested duration,
 * per-section harmony, instrumentation and which parts play where.
 */
import type { ModeName, SectionKind, TrackRole } from '../model/schema';
import { rng, type Rng } from '../util/math';
import { chordSymbol, isMinorish, romanToChord } from '../theory/theory';
import type { Brief } from './prompt';
import type { CompositionSpec, SpecSection, SpecTrack } from './spec';
import { GENRES, MOODS, SECTION_DEFAULTS, type GenreStyle, type RoleSpec } from './styles';
import { writeLyrics } from './lyrics';

const LABEL: Record<SectionKind, string> = {
  intro: 'Intro', verse: 'Verse', prechorus: 'Pre-Chorus', chorus: 'Chorus', postchorus: 'Post-Chorus', bridge: 'Bridge', breakdown: 'Breakdown',
  buildup: 'Build-Up', drop: 'Drop', solo: 'Solo', interlude: 'Interlude', outro: 'Outro', theme: 'Theme', development: 'Development', climax: 'Climax', coda: 'Coda', custom: 'Section',
};

export function chooseKey(r: Rng, style: GenreStyle, mood: string, creativity: number): { tonic: number; mode: ModeName } {
  const m = MOODS[mood] ?? MOODS.neutral;
  const pMinor = Math.max(0, Math.min(1, m.minor * 0.65 + style.preferMinor * 0.35));
  const minor = r.chance(pMinor);
  let pool = (minor ? style.minorModes : style.majorModes);
  const moodModes = (m.modes ?? []).filter((x) => pool.includes(x));
  if (moodModes.length && !r.chance(creativity * 0.5)) pool = moodModes;
  const mode = r.chance(0.7) ? pool[0] : r.pick(pool);
  const tonic = r.chance(0.75) ? r.pick(style.keys) : r.int(0, 11);
  return { tonic, mode };
}

/** Fit a template form to a target number of bars. */
export function fitStructure(r: Rng, template: { kind: SectionKind; bars: number; energy: number; optional?: boolean }[], targetBars: number) {
  let secs = template.map((s) => ({ ...s }));
  const total = () => secs.reduce((a, s) => a + s.bars, 0);
  // remove optional sections (later ones first) while far too long
  while (total() > targetBars * 1.12) {
    const idx = [...secs.keys()].reverse().find((i) => secs[i].optional);
    if (idx === undefined) break;
    secs.splice(idx, 1);
  }
  // still too long: shrink the longest sections in steps of 4 (keep >= 2 bars intros/outros, >= 4 others)
  let guard = 0;
  while (total() > targetBars * 1.06 && guard++ < 200) {
    const cand = secs.map((s, i) => [i, s.bars] as const).filter(([i, b]) => b > (['intro', 'outro', 'coda', 'interlude'].includes(secs[i].kind) ? 2 : 4));
    if (!cand.length) { if (secs.length > 2) secs.splice(secs.length - 2, 1); else break; continue; }
    const [i] = cand.reduce((a, b) => (b[1] > a[1] ? b : a));
    secs[i].bars -= secs[i].bars > 8 ? 4 : 2;
  }
  // too short: repeat the core (sections between intro and outro) before the ending
  guard = 0;
  while (total() < targetBars * 0.9 && guard++ < 20) {
    const core = secs.filter((s) => !['intro', 'outro', 'coda'].includes(s.kind));
    const tailIdx = secs.findIndex((s, i) => i > 0 && ['outro', 'coda'].includes(s.kind));
    const insertAt = tailIdx < 0 ? secs.length : tailIdx;
    const need = targetBars - total();
    // pick a verse/chorus (or theme/climax) pair
    const kindsInOrder = [...new Set(core.map((s) => s.kind).filter((k) => ['verse', 'chorus', 'theme', 'climax', 'drop', 'buildup', 'development', 'prechorus'].includes(k)))];
    const pairKinds = kindsInOrder.includes('verse') && kindsInOrder.includes('chorus') ? ['verse', 'chorus'] : kindsInOrder.includes('buildup') && kindsInOrder.includes('drop') ? ['buildup', 'drop'] : kindsInOrder.slice(0, 2);
    const pair = pairKinds.map((k) => [...core].reverse().find((s) => s.kind === k)!).filter(Boolean).map((s) => ({ ...s, optional: true, energy: Math.min(1, s.energy + 0.05) }));
    const add = pair.length ? pair : core.slice(-1).map((s) => ({ ...s }));
    if (!add.length) break;
    if (add.reduce((a, s) => a + s.bars, 0) > need * 1.6) {
      // just lengthen the biggest section instead
      const big = secs.reduce((a, s) => (s.bars > a.bars ? s : a));
      big.bars += 4;
    } else secs.splice(insertAt, 0, ...add);
  }
  if (!secs.length) secs = [{ kind: 'theme', bars: Math.max(4, targetBars), energy: 0.6 }];
  return secs;
}

function progressionFor(r: Rng, style: GenreStyle, minor: boolean, mood: string, kind: SectionKind, creativity: number): string[] {
  const pool = minor ? style.progMinor : style.progMajor;
  const bias = (MOODS[mood]?.progBias ?? []).filter((p) => (minor ? /^[bi#]?[iv]/.test(p[0]) || p[0].startsWith('VI') || p[0].startsWith('b') : /^[IV]/.test(p[0]) || p[0].startsWith('vi') || p[0].startsWith('b')));
  const candidates = [...pool, ...pool, ...bias];
  if (kind === 'bridge' || kind === 'development' || kind === 'breakdown') {
    // contrast: start away from the tonic
    const away = candidates.filter((p) => !/^(I|i)(\d|maj|$)/.test(p[0]));
    if (away.length) return r.pick(away);
  }
  if (r.chance(creativity * 0.3)) return r.pick([...pool, ...bias]);
  return r.pick(candidates);
}

export function realizeChordSymbols(romans: string[], bars: number, tonic: number, mode: ModeName, chordSize: number, harmonicRhythm: number, complexity: number, r: Rng, cadence: 'none' | 'half' | 'full', transpose = 0): string[] {
  const out: string[] = [];
  const perBar = harmonicRhythm >= 2 ? 2 : 1;
  const slowness = harmonicRhythm < 1 ? Math.round(1 / harmonicRhythm) : 1;
  const tk = (tonic + transpose + 12) % 12;
  const upgrade = (sym: string) => {
    if (chordSize >= 4 || complexity > 0.7) return sym;
    return sym;
  };
  const toSym = (roman: string) => {
    let rm = roman;
    if (complexity > 0.7 && !/\d/.test(rm) && !/[°ø]/.test(rm) && r.chance((complexity - 0.6) * 1.2)) rm = rm + '7';
    if (chordSize >= 5 && /7$/.test(rm) && r.chance(0.4)) rm = rm.replace(/7$/, '9');
    const ch = romanToChord(rm, tk, mode);
    return upgrade(chordSymbol(ch, [1, 3, 5, 8, 10].includes(tk)));
  };
  let idx = 0;
  for (let b = 0; b < bars; b++) {
    if (perBar === 2) {
      const a = toSym(romans[idx % romans.length]);
      const c2 = toSym(romans[(idx + 1) % romans.length]);
      out.push(`${a} ${c2}`);
      idx += 2;
    } else {
      out.push(toSym(romans[Math.floor(idx / slowness) % romans.length]));
      idx++;
    }
  }
  if (bars >= 2 && cadence !== 'none') {
    const minor = isMinorish(mode);
    if (cadence === 'half') out[bars - 1] = toSym(minor && mode !== 'dorian' ? 'V' : 'V');
    else {
      out[bars - 1] = toSym(minor ? 'i' : 'I');
      if (bars >= 3 && r.chance(0.7)) out[bars - 2] = toSym(r.chance(0.6) ? 'V' : 'IV');
    }
  }
  return out;
}

function rolesFor(style: GenreStyle, brief: Brief, r: Rng): (RoleSpec & { requested?: boolean })[] {
  const explicit = brief.instruments.length > 0;
  let roles: (RoleSpec & { requested?: boolean })[] = style.roles.map((x) => ({ ...x }));
  for (const inst of brief.instruments) {
    if (roles.some((x) => x.preset === inst.preset)) { roles.find((x) => x.preset === inst.preset)!.requested = true; continue; }
    if (inst.role === 'drums' && roles.some((x) => x.role === 'drums' || x.role === 'percussion')) {
      roles.filter((x) => x.role === 'drums' || x.role === 'percussion').forEach((x) => (x.requested = true));
      continue;
    }
    const same = roles.find((x) => x.role === inst.role && !x.requested);
    const minEnergy = inst.role === 'melody' ? 0.45 : inst.role === 'brass' ? 0.6 : inst.role === 'percussion' ? 0.55 : inst.role === 'drums' ? 0.4 : inst.role === 'fx' ? 0 : 0.3;
    if (same && inst.role !== 'percussion' && inst.role !== 'fx') {
      same.preset = inst.preset; same.name = inst.name; same.requested = true;
      if (inst.comp) same.comp = inst.comp as RoleSpec['comp'];
    } else roles.push({ role: inst.role, name: inst.name, preset: inst.preset, comp: inst.comp as RoleSpec['comp'], minEnergy, requested: true, skip: inst.role === 'melody' ? ['intro'] : undefined });
  }
  if (explicit && brief.explicitInstrumentation) roles = roles.filter((x) => x.requested || ['drums', 'bass'].includes(x.role));
  roles = roles.filter((x) => !brief.excludeRoles.includes(x.role));
  if (brief.wantsAmbience === 'rain' && !roles.some((x) => x.preset === 'rain-ambience')) roles.push({ role: 'fx', name: 'Rain Ambience', preset: 'rain-ambience', minEnergy: 0 });
  // complexity: drop the least important parts for simple songs, add counter-line for complex ones
  if (brief.complexity < 0.3) roles = roles.filter((x, i) => i < 4 || x.requested);
  if (brief.complexity > 0.7 && !roles.some((x) => x.role === 'countermelody')) roles.push({ role: 'countermelody', name: 'Counter-Melody', preset: style.id === 'orchestral' ? 'cellos' : 'flute', minEnergy: 0.7 });
  if (brief.vocals !== 'none') {
    roles.push({ role: 'vocal', name: brief.vocalVoice === 'female' ? 'Lead Vocal (F) – guide' : brief.vocalVoice === 'male' ? 'Lead Vocal (M) – guide' : 'Lead Vocal – guide', preset: 'vocal-guide', minEnergy: 0, skip: ['intro', 'outro', 'solo', 'interlude', 'breakdown', 'drop', 'buildup', 'coda'] });
    if (brief.complexity >= 0.4) roles.push({ role: 'backing-vocal', name: 'Backing Vocals – guide', preset: 'synth-choir', minEnergy: 0.82, skip: ['intro', 'outro', 'verse', 'solo'] });
  }
  void r;
  return roles;
}

const SECTION_ROLE_RULES: Partial<Record<SectionKind, { only?: TrackRole[]; never?: TrackRole[] }>> = {
  breakdown: { never: ['drums', 'bass', 'percussion'] },
  intro: { never: ['vocal', 'backing-vocal'] },
  outro: { never: ['vocal', 'backing-vocal'] },
};

export function planSong(brief: Brief, seed: number): CompositionSpec {
  const r = rng(seed);
  const style = GENRES[brief.genre] ?? GENRES.pop;
  const mood = MOODS[brief.mood] ?? MOODS.neutral;
  // tempo
  let bpm: number;
  const [lo, hi] = style.bpm;
  if (brief.bpm && brief.bpm > 0) bpm = brief.bpm;
  else {
    let t = 0.5 + mood.tempo * 1.5 + r.gauss(0, 0.15);
    if (brief.bpm === -1) t = 0.05;
    if (brief.bpm === -2) t = 0.95;
    bpm = Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, t)));
  }
  const timeSig = brief.timeSig ?? style.timeSig;
  const beatsPerBar = (timeSig[0] * 4) / timeSig[1];
  const key = brief.key ?? chooseKey(r, style, brief.mood, brief.creativity);
  const minor = isMinorish(key.mode);
  // form
  const targetBars = Math.max(4, Math.round((brief.durationSec * bpm) / 60 / beatsPerBar));
  const template = brief.structure
    ? brief.structure.map((k) => ({ kind: k, ...SECTION_DEFAULTS[k] }))
    : style.structure;
  const form = fitStructure(r, template, targetBars);
  // energies
  const eShift = (brief.energy - 0.6) * 0.5 + mood.energy * 0.3;
  const counts: Partial<Record<SectionKind, number>> = {};
  const totals: Partial<Record<SectionKind, number>> = {};
  for (const s of form) totals[s.kind] = (totals[s.kind] ?? 0) + 1;
  const lastHigh = [...form.keys()].reverse().find((i) => ['chorus', 'climax', 'drop'].includes(form[i].kind));
  const roles = rolesFor(style, brief, r);
  const progByKind = new Map<string, string[]>();
  const sections: SpecSection[] = form.map((s, i) => {
    counts[s.kind] = (counts[s.kind] ?? 0) + 1;
    let energy = Math.max(0.1, Math.min(1, s.energy + eShift));
    if (brief.soft) energy = Math.min(energy, 0.7);
    if (brief.wantsClimax && i === lastHigh) energy = 1;
    const n = counts[s.kind]!;
    const name = totals[s.kind]! > 1 ? (i === lastHigh && n === totals[s.kind] && n > 1 ? `Final ${LABEL[s.kind]}` : `${LABEL[s.kind]} ${n}`) : LABEL[s.kind];
    // harmony: same progression for repeated section kinds (song coherence)
    const harmonyKey = s.kind === 'intro' || s.kind === 'outro' || s.kind === 'coda' ? (form.find((x) => ['verse', 'theme', 'chorus'].includes(x.kind))?.kind ?? s.kind) : s.kind === 'postchorus' ? 'chorus' : s.kind;
    let prog = progByKind.get(harmonyKey);
    if (!prog) { prog = progressionFor(r, style, minor, brief.mood, harmonyKey as SectionKind, brief.creativity); progByKind.set(harmonyKey, prog); }
    const next = form[i + 1];
    const cadence = i === form.length - 1 ? 'full' : next && ['chorus', 'climax', 'drop'].includes(next.kind) && !['buildup'].includes(s.kind) ? 'half' : 'none';
    const transpose = style.liftFinal && i === lastHigh && n > 1 && brief.creativity >= 0.35 && totals[s.kind]! >= 2 ? style.liftFinal : 0;
    const chords = realizeChordSymbols(prog, s.bars, key.tonic, key.mode, style.chordSize, style.harmonicRhythm, brief.complexity, r, cadence, transpose);
    // parts that play here
    const rule = SECTION_ROLE_RULES[s.kind];
    const playing = roles.filter((ro) => {
      if (rule?.never?.includes(ro.role)) return false;
      if (ro.skip?.includes(s.kind)) return false;
      if (ro.role === 'fx' && (ro.preset === 'noise-riser' || ro.preset === 'timpani' || ro.preset === 'impact')) return true; // fx decide internally
      return energy >= ro.minEnergy - 1e-6;
    }).map((ro) => ro.role);
    // vocals replace the instrumental melody where they sing
    const vocalHere = playing.includes('vocal');
    let roleList = [...new Set(playing)];
    if (vocalHere) roleList = roleList.filter((x) => x !== 'melody' || energy >= 0.95);
    if (s.kind === 'intro' && roleList.length > 3) roleList = roleList.filter((x) => !['brass', 'countermelody', 'arp', 'percussion'].includes(x) || r.chance(0.3));
    return { name, kind: s.kind, bars: s.bars, energy, chords, roles: roleList, transpose };
  });
  const tracks: SpecTrack[] = [];
  const seenNames = new Set<string>();
  for (const ro of roles) {
    let name = ro.name;
    let k = 2;
    while (seenNames.has(name)) name = `${ro.name} ${k++}`;
    seenNames.add(name);
    tracks.push({ name, role: ro.role, preset: ro.preset, comp: ro.comp, center: ro.center, volume: ro.volume, effects: ro.effects ?? [] });
  }
  // drums: prompt may ask for cinematic drums in a non-orchestral style
  let drums = style.drums;
  if (brief.soft && drums === 'backbeat') drums = 'ballad';
  const lyrics = brief.vocals !== 'none'
    ? sections.filter((s) => s.roles.includes('vocal')).map((s) => ({ section: s.name, text: writeLyrics(s.kind, brief.mood, Math.max(2, Math.floor(s.bars / 2)), seed + s.bars, '') }))
    : [];
  return {
    title: '',
    genre: style.id,
    mood: brief.mood,
    bpm,
    key,
    timeSignature: { numerator: timeSig[0], denominator: timeSig[1] },
    sections,
    tracks,
    drums,
    bass: style.bass,
    swing: style.swing,
    melodyDensity: Math.max(0.1, Math.min(1, style.melodyDensity + (brief.complexity - 0.5) * 0.3)),
    syncopation: style.syncopation,
    complexity: brief.complexity,
    creativity: brief.creativity,
    mastering: style.mastering,
    ritardando: !!style.ritardando,
    seed,
    parts: [],
    lyrics,
    vocalStyle: brief.vocals !== 'none' ? { voice: brief.vocalVoice, delivery: brief.mood } : undefined,
    notes: brief.notes.join(' '),
  };
}

export function songTitle(brief: Brief, seed: number): string {
  const r = rng(seed * 7 + 3);
  const a: Record<string, string[]> = {
    heroic: ['Rise of the', 'Banners of', 'The Last', 'Call of the'], epic: ['Legends of', 'Empire of', 'Echoes of'], sad: ['Letters to', 'After the', 'Fading'],
    happy: ['Sunny', 'Golden', 'Good Days in'], dark: ['Shadows of', 'Beneath the', 'Night of'], intense: ['Breaking', 'Wildfire in', 'Edge of'],
    peaceful: ['Quiet', 'Still Waters of', 'Morning in'], motivational: ['Higher', 'Unstoppable', 'Beyond the'], mysterious: ['Secrets of', 'The Hidden', 'Whispers of'],
    uplifting: ['Skyward', 'Brighter', 'Wings of'], emotional: ['Remember', 'Heart of', 'Between the'], romantic: ['Only', 'Moonlight', 'Close to'], chill: ['Slow', 'Late Night', 'Coffee &'], energetic: ['Turn Up', 'Electric', 'Pulse of'], neutral: ['Untitled', 'Notes on', 'Study in'],
  };
  const b = ['Horizon', 'the Storm', 'Valor', 'Tomorrow', 'the Sea', 'Neon Dreams', 'Glass', 'Embers', 'the North', 'Starlight', 'Rain', 'Home', 'Gravity', 'Afterglow', 'the Machine'];
  const first = a[brief.mood] ?? a.neutral;
  return `${r.pick(first)} ${r.pick(b)}`.replace(/\s+/g, ' ');
}
