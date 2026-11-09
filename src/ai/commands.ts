/**
 * Validated editing commands. Claude (or the local assistant) never runs code:
 * it returns JSON commands that are schema-validated here and applied by pure
 * project transformations. Unknown or invalid commands are rejected with a reason.
 */
import { z } from 'zod';
import { quantizeNotes, mapNotesInRange } from '../model/clipOps';
import { EFFECT_DEFS, makeEffect, masteringChain, sanitizeParams, MASTERING_PRESETS } from '../model/effects';
import { newMidiClip, newNote } from '../model/factory';
import { instrumentFromPreset, PRESET_MAP } from '../model/presets';
import { EffectTypeSchema, ModeSchema, SectionKindSchema, TrackRoleSchema, type Project, type Track } from '../model/schema';
import { MeterMap } from '../model/tempo';
import { uid } from '../util/id';
import { parseKey, parseNoteName } from '../theory/theory';
import { clearRange } from '../model/clipOps';
import {
  addInstrument, alignVocals, changeEnergy, changeGenre, createVariation, ensureSections, extendSong, findTracks, generateHarmonies, humanize,
  improveChords, improveMelody, improveRhythm, makeCinematic, newIntroOrEnding, regenerateSections, remix, sectionsInRange, setSectionChords,
  setSectionEnergy, softenArrangement, transposeSong, writeLocalLyrics, octaveDouble, invertMelody,
} from '../compose/transform';
import { GENRES } from '../compose/styles';

const Range = z.object({
  section: z.string().max(60).optional().describe('Section name or kind, e.g. "Chorus 2" or "chorus" (all choruses)'),
  from_bar: z.number().int().min(1).max(2000).optional(),
  to_bar: z.number().int().min(1).max(2000).optional().describe('inclusive'),
  selection: z.boolean().optional().describe('use the user\'s current selection'),
}).optional();

const NoteIn = z.object({ pitch: z.union([z.number().int().min(0).max(127), z.string().min(2).max(4)]), start: z.number().min(0).max(4096), duration: z.number().min(1 / 64).max(256), velocity: z.number().min(0).max(1).default(0.8), lyric: z.string().max(30).optional() });

export const CommandSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_tempo'), bpm: z.number().min(30).max(260) }),
  z.object({ op: z.literal('set_key'), key: z.string().max(30).optional(), tonic: z.number().int().min(0).max(11).optional(), mode: ModeSchema.optional(), transpose_notes: z.boolean().default(true) }),
  z.object({ op: z.literal('set_time_signature'), numerator: z.number().int().min(2).max(15), denominator: z.union([z.literal(4), z.literal(8)]) }),
  z.object({ op: z.literal('add_track'), instrument: z.string().max(60), name: z.string().max(40).optional(), role: TrackRoleSchema.optional() }),
  z.object({ op: z.literal('remove_track'), track: z.string().max(60) }),
  z.object({ op: z.literal('set_instrument'), track: z.string().max(60), preset: z.string().max(40) }),
  z.object({ op: z.literal('set_track'), track: z.string().max(60), volume_db: z.number().min(-60).max(6).optional(), pan: z.number().min(-1).max(1).optional(), mute: z.boolean().optional(), solo: z.boolean().optional(), name: z.string().max(40).optional() }),
  z.object({ op: z.literal('adjust_volume'), track: z.string().max(60), delta_db: z.number().min(-24).max(24) }),
  z.object({ op: z.literal('add_effect'), target: z.string().max(60), type: EffectTypeSchema, params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}) }),
  z.object({ op: z.literal('set_effect_param'), target: z.string().max(60), type: EffectTypeSchema, param: z.string().max(30), value: z.union([z.number(), z.string(), z.boolean()]) }),
  z.object({ op: z.literal('remove_effect'), target: z.string().max(60), type: EffectTypeSchema }),
  z.object({ op: z.literal('set_send'), track: z.string().max(60), bus: z.enum(['reverb', 'delay']), level: z.number().min(0).max(1) }),
  z.object({ op: z.literal('set_synth_param'), track: z.string().max(60), param: z.string().max(40), value: z.union([z.number(), z.string()]) }),
  z.object({ op: z.literal('regenerate'), range: Range, roles: z.array(TrackRoleSchema).max(20).optional(), tracks: z.array(z.string().max(60)).max(20).optional() }),
  z.object({ op: z.literal('improve'), aspect: z.enum(['melody', 'chords', 'rhythm']), range: Range }),
  z.object({ op: z.literal('energy'), delta: z.number().min(-1).max(1), range: Range }),
  z.object({ op: z.literal('soften'), range: Range }),
  z.object({ op: z.literal('variation'), range: Range }),
  z.object({ op: z.literal('extend'), bars: z.number().int().min(1).max(128), kinds: z.array(SectionKindSchema).max(8).optional() }),
  z.object({ op: z.literal('new_section'), which: z.enum(['intro', 'outro']) }),
  z.object({ op: z.literal('harmonies'), range: Range }),
  z.object({ op: z.literal('humanize'), amount: z.number().min(0).max(1).default(0.5), range: Range }),
  z.object({ op: z.literal('quantize'), grid: z.number().min(1 / 32).max(4).default(0.25), strength: z.number().min(0).max(1).default(1), track: z.string().max(60).optional(), range: Range }),
  z.object({ op: z.literal('transpose'), semitones: z.number().int().min(-24).max(24), track: z.string().max(60).optional(), range: Range }),
  z.object({ op: z.literal('octave_double'), track: z.string().max(60), octaves: z.number().int().min(-2).max(2).default(1), range: Range }),
  z.object({ op: z.literal('invert_melody'), track: z.string().max(60), range: Range }),
  z.object({ op: z.literal('set_chords'), section: z.string().max(60), chords: z.array(z.string().max(20)).min(1).max(64) }),
  z.object({ op: z.literal('set_section_energy'), section: z.string().max(60), energy: z.number().min(0).max(1) }),
  z.object({ op: z.literal('make_cinematic') }),
  z.object({ op: z.literal('change_genre'), genre: z.string().max(30) }),
  z.object({ op: z.literal('remix') }),
  z.object({ op: z.literal('write_notes'), track: z.string().max(60), start_bar: z.number().int().min(1).max(2000), length_bars: z.number().int().min(1).max(64), replace: z.boolean().default(true), notes: z.array(NoteIn).max(1500) }),
  z.object({ op: z.literal('set_mastering'), preset: z.string().max(30) }),
  z.object({ op: z.literal('write_lyrics'), section: z.string().max(60).optional(), text: z.string().max(3000).optional(), topic: z.string().max(200).optional() }),
  z.object({ op: z.literal('swing'), amount: z.number().min(0).max(1), track: z.string().max(60).optional() }),
  z.object({ op: z.literal('set_loop'), from_bar: z.number().int().min(1), to_bar: z.number().int().min(1), enabled: z.boolean().default(true) }),
  z.object({ op: z.literal('add_marker'), bar: z.number().int().min(1), name: z.string().max(40) }),
  z.object({ op: z.literal('automate'), track: z.string().max(60), target: z.string().max(40), points: z.array(z.object({ bar: z.number().min(1), value: z.number() })).min(1).max(256) }),
  z.object({ op: z.literal('message'), text: z.string().max(2000) }),
]);
export type Command = z.infer<typeof CommandSchema>;

export interface CommandContext {
  selection: { from: number; to: number } | null;
  selectedTrackIds: string[];
  seed?: number;
}
export interface ApplyResult { project: Project; applied: string[]; errors: string[]; messages: string[] }

export function validateCommands(raw: unknown): { commands: Command[]; errors: string[] } {
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as any).commands) ? (raw as any).commands : null;
  if (!arr) return { commands: [], errors: ['Response did not contain a "commands" array.'] };
  const commands: Command[] = [];
  const errors: string[] = [];
  arr.slice(0, 40).forEach((c: unknown, i: number) => {
    const r = CommandSchema.safeParse(c);
    if (r.success) commands.push(r.data);
    else errors.push(`command ${i + 1} rejected: ${r.error.issues.slice(0, 2).map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`);
  });
  return { commands, errors };
}

function resolveRange(p: Project, range: z.infer<typeof Range>, ctx: CommandContext): { from: number; to: number; sections: number[] } {
  const meter = MeterMap.fromProject(p);
  const end = p.sections.reduce((m, s) => Math.max(m, s.start + s.length), 0);
  if (!range) {
    if (ctx.selection) return { ...ctx.selection, sections: sectionsInRange(p, ctx.selection.from, ctx.selection.to) };
    return { from: 0, to: Math.max(end, 1e9), sections: p.sections.map((_, i) => i) };
  }
  if (range.selection && ctx.selection) return { ...ctx.selection, sections: sectionsInRange(p, ctx.selection.from, ctx.selection.to) };
  if (range.section) {
    const q = range.section.toLowerCase().trim();
    let idx = p.sections.map((s, i) => [s, i] as const).filter(([s]) => s.name.toLowerCase() === q).map(([, i]) => i);
    if (!idx.length) idx = p.sections.map((s, i) => [s, i] as const).filter(([s]) => s.kind === q || s.name.toLowerCase().startsWith(q) || (q.startsWith('final') && s.name.toLowerCase().startsWith('final'))).map(([, i]) => i);
    if (q === 'last' || q === 'ending') idx = [p.sections.length - 1];
    if (q === 'first') idx = [0];
    if (idx.length) {
      const from = Math.min(...idx.map((i) => p.sections[i].start));
      const to = Math.max(...idx.map((i) => p.sections[i].start + p.sections[i].length));
      return { from, to, sections: idx };
    }
    throw new Error(`No section named "${range.section}". Sections: ${p.sections.map((s) => s.name).join(', ')}`);
  }
  if (range.from_bar) {
    const from = meter.barToBeat(range.from_bar - 1);
    const to = meter.barToBeat(range.to_bar ?? range.from_bar);
    return { from, to, sections: sectionsInRange(p, from, to) };
  }
  return { from: 0, to: 1e9, sections: p.sections.map((_, i) => i) };
}

function oneTrack(p: Project, q: string, ctx: CommandContext): Track {
  if (q === 'selected' && ctx.selectedTrackIds.length) {
    const t = p.tracks.find((x) => x.id === ctx.selectedTrackIds[0]);
    if (t) return t;
  }
  const exact = p.tracks.find((t) => t.name.toLowerCase() === q.toLowerCase() || t.id === q);
  if (exact) return exact;
  const found = findTracks(p, q);
  if (!found.length) throw new Error(`No track matches "${q}". Tracks: ${p.tracks.map((t) => t.name).join(', ')}`);
  return found[0];
}
function manyTracks(p: Project, q: string, ctx: CommandContext): Track[] {
  if (q === 'selected' && ctx.selectedTrackIds.length) return p.tracks.filter((t) => ctx.selectedTrackIds.includes(t.id));
  const exact = p.tracks.filter((t) => t.name.toLowerCase() === q.toLowerCase());
  if (exact.length) return exact;
  const found = findTracks(p, q);
  if (!found.length) throw new Error(`No track matches "${q}"`);
  return found;
}
const updateTrack = (p: Project, id: string, fn: (t: Track) => Track): Project => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? fn(t) : t)) });

function effectHost(p: Project, target: string, ctx: CommandContext): { kind: 'master' } | { kind: 'return'; id: string } | { kind: 'track'; id: string } {
  const q = target.toLowerCase();
  if (q === 'master' || q === 'mix') return { kind: 'master' };
  const ret = p.returns.find((r) => r.name.toLowerCase() === q || r.id === target);
  if (ret) return { kind: 'return', id: ret.id };
  return { kind: 'track', id: oneTrack(p, target, ctx).id };
}
function mapEffects(p: Project, host: ReturnType<typeof effectHost>, fn: (fx: Track['effects']) => Track['effects']): Project {
  if (host.kind === 'master') return { ...p, master: { ...p.master, effects: fn(p.master.effects) } };
  if (host.kind === 'return') return { ...p, returns: p.returns.map((r) => (r.id === host.id ? { ...r, effects: fn(r.effects) } : r)) };
  return updateTrack(p, host.id, (t) => ({ ...t, effects: fn(t.effects) }));
}

function setPath(obj: any, path: string, value: unknown): boolean {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!o || typeof o !== 'object' || !(parts[i] in o)) return false;
    o = o[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (!o || typeof o !== 'object' || !(last in o)) return false;
  if (typeof o[last] !== typeof value) return false;
  o[last] = value;
  return true;
}

export function applyCommands(project: Project, commands: Command[], ctx: CommandContext): ApplyResult {
  let p = ensureSections(project);
  const applied: string[] = [];
  const errors: string[] = [];
  const messages: string[] = [];
  let seed = ctx.seed ?? Math.floor(Math.random() * 1e9);
  const meter = () => MeterMap.fromProject(p);
  for (const c of commands) {
    seed += 7919;
    try {
      switch (c.op) {
        case 'message': messages.push(c.text); break;
        case 'set_tempo': p = { ...p, bpm: Math.round(c.bpm * 10) / 10, tempoChanges: p.tempoChanges.map((t) => ({ ...t, bpm: t.bpm * (c.bpm / p.bpm) })) }; applied.push(`Tempo → ${c.bpm} BPM`); break;
        case 'set_key': {
          const k = c.key ? parseKey(c.key) : c.tonic !== undefined ? { tonic: c.tonic, mode: c.mode ?? p.key.mode } : null;
          if (!k) throw new Error('Could not understand key');
          const mode = c.mode ?? k.mode;
          if (c.transpose_notes) {
            let d = k.tonic - p.key.tonic;
            if (d > 6) d -= 12;
            if (d < -6) d += 12;
            p = transposeSong(p, d);
          }
          p = { ...p, key: { tonic: k.tonic, mode } };
          applied.push(`Key → ${c.key ?? k.tonic} ${mode}`);
          break;
        }
        case 'set_time_signature': p = { ...p, timeSignature: { numerator: c.numerator, denominator: c.denominator } }; applied.push(`Time signature → ${c.numerator}/${c.denominator}`); break;
        case 'add_track': {
          const before = p.tracks.length;
          p = addInstrument(p, c.instrument, seed, PRESET_MAP[c.instrument] ? c.instrument : undefined);
          if (c.name && p.tracks.length > before) p = updateTrack(p, p.tracks[p.tracks.length - 1].id, (t) => ({ ...t, name: c.name! }));
          applied.push(`Added ${p.tracks[p.tracks.length - 1].name} with a composed part`);
          break;
        }
        case 'remove_track': {
          const ts = manyTracks(p, c.track, ctx);
          p = { ...p, tracks: p.tracks.filter((t) => !ts.includes(t)) };
          applied.push(`Removed ${ts.map((t) => t.name).join(', ')}`);
          break;
        }
        case 'set_instrument': {
          const t = oneTrack(p, c.track, ctx);
          if (!PRESET_MAP[c.preset]) throw new Error(`Unknown preset "${c.preset}"`);
          const inst = instrumentFromPreset(c.preset);
          p = updateTrack(p, t.id, (x) => ({ ...x, instrument: inst, type: inst.kind === 'drumkit' ? 'drums' : 'instrument' }));
          applied.push(`${t.name} now uses ${PRESET_MAP[c.preset].name}`);
          break;
        }
        case 'set_track': {
          for (const t of manyTracks(p, c.track, ctx)) {
            p = updateTrack(p, t.id, (x) => ({ ...x, ...(c.volume_db !== undefined ? { volume: c.volume_db } : {}), ...(c.pan !== undefined ? { pan: c.pan } : {}), ...(c.mute !== undefined ? { mute: c.mute } : {}), ...(c.solo !== undefined ? { solo: c.solo } : {}), ...(c.name ? { name: c.name } : {}) }));
            applied.push(`Updated ${t.name}`);
          }
          break;
        }
        case 'adjust_volume': {
          for (const t of manyTracks(p, c.track, ctx)) {
            p = updateTrack(p, t.id, (x) => ({ ...x, volume: Math.max(-60, Math.min(6, x.volume + c.delta_db)) }));
            applied.push(`${t.name} ${c.delta_db > 0 ? '+' : ''}${c.delta_db} dB`);
          }
          break;
        }
        case 'add_effect': {
          const host = effectHost(p, c.target, ctx);
          const fx = makeEffect(c.type, c.params);
          if (c.type === 'ducking' && !fx.params.source) fx.params.source = p.tracks.find((t) => t.role === 'drums')?.id ?? '';
          p = mapEffects(p, host, (list) => (c.type === 'limiter' ? [...list, fx] : (() => { const li = list.findIndex((e) => e.type === 'limiter'); return li >= 0 ? [...list.slice(0, li), fx, ...list.slice(li)] : [...list, fx]; })()));
          applied.push(`Added ${EFFECT_DEFS[c.type].name} on ${c.target}`);
          break;
        }
        case 'set_effect_param': {
          const host = effectHost(p, c.target, ctx);
          let found = false;
          p = mapEffects(p, host, (list) => list.map((e) => {
            if (e.type !== c.type || found) return e;
            found = true;
            return { ...e, params: { ...e.params, ...sanitizeParams(e.type, { [c.param]: c.value }) } };
          }));
          if (!found) {
            p = mapEffects(p, host, (list) => [...list, makeEffect(c.type, { [c.param]: c.value })]);
          }
          applied.push(`${EFFECT_DEFS[c.type].name} ${c.param} → ${c.value} on ${c.target}`);
          break;
        }
        case 'remove_effect': {
          const host = effectHost(p, c.target, ctx);
          p = mapEffects(p, host, (list) => list.filter((e) => e.type !== c.type));
          applied.push(`Removed ${EFFECT_DEFS[c.type].name} from ${c.target}`);
          break;
        }
        case 'set_send': {
          const id = c.bus === 'reverb' ? 'ret-reverb' : 'ret-delay';
          for (const t of manyTracks(p, c.track, ctx)) {
            p = updateTrack(p, t.id, (x) => ({ ...x, sends: x.sends.some((s) => s.returnId === id) ? x.sends.map((s) => (s.returnId === id ? { ...s, level: c.level } : s)) : [...x.sends, { returnId: id, level: c.level }] }));
            applied.push(`${t.name} ${c.bus} send → ${Math.round(c.level * 100)}%`);
          }
          break;
        }
        case 'set_synth_param': {
          const t = oneTrack(p, c.track, ctx);
          const inst = structuredClone(t.instrument);
          if (!setPath(inst.params, c.param, c.value)) throw new Error(`Unknown synth parameter "${c.param}"`);
          p = updateTrack(p, t.id, (x) => ({ ...x, instrument: inst }));
          applied.push(`${t.name}: ${c.param} → ${c.value}`);
          break;
        }
        case 'regenerate': {
          const r = resolveRange(p, c.range, ctx);
          const trackIds = c.tracks?.flatMap((q) => manyTracks(p, q, ctx).map((t) => t.id));
          p = regenerateSections(p, r.sections, { roles: c.roles ?? 'all', trackIds, seed });
          applied.push(`Regenerated ${c.roles?.join('/') ?? (trackIds ? 'selected tracks' : 'all parts')} in ${r.sections.map((i) => p.sections[i].name).join(', ')}`);
          break;
        }
        case 'improve': {
          const r = resolveRange(p, c.range, ctx);
          p = c.aspect === 'melody' ? improveMelody(p, r.sections, seed) : c.aspect === 'chords' ? improveChords(p, r.sections, seed) : improveRhythm(p, r.sections, seed);
          applied.push(`New ${c.aspect} in ${r.sections.map((i) => p.sections[i]?.name).join(', ')}`);
          break;
        }
        case 'energy': {
          const r = resolveRange(p, c.range, ctx);
          p = changeEnergy(p, r.sections, c.delta, seed);
          applied.push(`${c.delta > 0 ? 'Raised' : 'Lowered'} energy in ${r.sections.map((i) => p.sections[i].name).join(', ')}`);
          break;
        }
        case 'soften': {
          const r = resolveRange(p, c.range, ctx);
          p = softenArrangement(p, r.sections, seed);
          applied.push(`Softened ${r.sections.map((i) => p.sections[i].name).join(', ')}`);
          break;
        }
        case 'variation': {
          const r = resolveRange(p, c.range, ctx);
          p = createVariation(p, r.sections, seed);
          applied.push(`Created a variation of ${r.sections.map((i) => p.sections[i].name).join(', ')}`);
          break;
        }
        case 'extend': p = extendSong(p, c.bars, seed, c.kinds); applied.push(`Extended the song by ${c.bars} bars`); break;
        case 'new_section': p = newIntroOrEnding(p, c.which, seed); applied.push(`Composed a new ${c.which === 'intro' ? 'introduction' : 'ending'}`); break;
        case 'harmonies': { const r = resolveRange(p, c.range, ctx); p = generateHarmonies(p, r.sections, seed); applied.push('Generated harmony line'); break; }
        case 'humanize': { const r = resolveRange(p, c.range, ctx); p = humanize(p, r.from, r.to, c.amount, seed); applied.push(`Humanized timing & velocity (${Math.round(c.amount * 100)}%)`); break; }
        case 'quantize': {
          const r = resolveRange(p, c.range, ctx);
          const ts = c.track ? manyTracks(p, c.track, ctx) : p.tracks;
          for (const t of ts) p = updateTrack(p, t.id, (x) => mapNotesInRange(x, r.from, r.to, (ns) => quantizeNotes(ns, c.grid, c.strength)));
          applied.push(`Quantized to 1/${Math.round(4 / c.grid)}`);
          break;
        }
        case 'transpose': {
          const r = resolveRange(p, c.range, ctx);
          if (c.track) for (const t of manyTracks(p, c.track, ctx)) p = updateTrack(p, t.id, (x) => mapNotesInRange(x, r.from, r.to, (ns) => ns.map((n) => ({ ...n, pitch: Math.max(0, Math.min(127, n.pitch + c.semitones)) }))));
          else p = transposeSong(p, c.semitones, r.from <= 0 && r.to >= 1e8 ? 0 : r.from, r.from <= 0 && r.to >= 1e8 ? Infinity : r.to);
          applied.push(`Transposed ${c.semitones > 0 ? '+' : ''}${c.semitones}`);
          break;
        }
        case 'octave_double': { const r = resolveRange(p, c.range, ctx); const t = oneTrack(p, c.track, ctx); p = octaveDouble(p, t.id, r.from, r.to, c.octaves); applied.push(`Doubled ${t.name} ${c.octaves > 0 ? 'up' : 'down'} an octave`); break; }
        case 'invert_melody': { const r = resolveRange(p, c.range, ctx); const t = oneTrack(p, c.track, ctx); p = invertMelody(p, t.id, r.from, r.to); applied.push(`Inverted ${t.name}`); break; }
        case 'set_chords': {
          const r = resolveRange(p, { section: c.section }, ctx);
          for (const si of r.sections) p = setSectionChords(p, si, c.chords, seed);
          applied.push(`Chords of ${c.section} → ${c.chords.join(' ')}`);
          break;
        }
        case 'set_section_energy': { const r = resolveRange(p, { section: c.section }, ctx); for (const si of r.sections) p = setSectionEnergy(p, si, c.energy); applied.push(`Energy of ${c.section} → ${c.energy}`); break; }
        case 'make_cinematic': p = makeCinematic(p, seed); applied.push('Added cinematic orchestration (strings, ostinato, horns, taiko, choir, timpani) and a hall reverb'); break;
        case 'change_genre': {
          const g = c.genre.toLowerCase();
          if (!GENRES[g]) throw new Error(`Unknown genre "${c.genre}"`);
          p = changeGenre(p, g, seed);
          applied.push(`Re-arranged as ${GENRES[g].label} (form & harmony kept)`);
          break;
        }
        case 'remix': p = remix(p, seed); applied.push(`Remixed: ${p.name}`); break;
        case 'write_notes': {
          const t = oneTrack(p, c.track, ctx);
          const start = meter().barToBeat(c.start_bar - 1);
          const end = meter().barToBeat(c.start_bar - 1 + c.length_bars);
          const notes = c.notes.map((n) => newNote(typeof n.pitch === 'number' ? n.pitch : parseNoteName(n.pitch) ?? 60, n.start, n.duration, n.velocity, n.lyric)).filter((n) => n.start < end - start);
          p = updateTrack(p, t.id, (x) => {
            const base = c.replace ? clearRange(x, start, end) : x;
            return { ...base, clips: [...base.clips, newMidiClip(start, end - start, notes, 'AI notes')].sort((a, b) => a.start - b.start) };
          });
          applied.push(`Wrote ${notes.length} notes on ${t.name} (bars ${c.start_bar}–${c.start_bar + c.length_bars - 1})`);
          break;
        }
        case 'set_mastering': {
          if (!MASTERING_PRESETS.some((m) => m.id === c.preset)) throw new Error(`Unknown mastering preset "${c.preset}"`);
          p = { ...p, master: { ...p.master, effects: masteringChain(c.preset), preset: c.preset } };
          applied.push(`Mastering → ${c.preset}`);
          break;
        }
        case 'write_lyrics': {
          if (c.text && c.section) {
            const sec = p.sections.find((s) => s.name.toLowerCase() === c.section!.toLowerCase()) ?? p.sections.find((s) => s.kind === c.section!.toLowerCase());
            const existing = p.lyrics.sections.find((l) => l.sectionId === sec?.id || l.label === c.section);
            const entry = { id: existing?.id ?? uid('l'), label: sec?.name ?? c.section, sectionId: sec?.id ?? null, text: c.text };
            p = { ...p, lyrics: { ...p.lyrics, sections: existing ? p.lyrics.sections.map((l) => (l.id === existing.id ? entry : l)) : [...p.lyrics.sections, entry] } };
          } else p = writeLocalLyrics(p, c.topic ?? '', seed);
          p = alignVocals(p, seed);
          applied.push('Updated lyrics and re-aligned the vocal melody');
          break;
        }
        case 'swing': {
          const ts = c.track ? manyTracks(p, c.track, ctx) : p.tracks;
          for (const t of ts) p = updateTrack(p, t.id, (x) => ({ ...x, clips: x.clips.map((cl) => ({ ...cl, swing: c.amount })) }));
          applied.push(`Swing → ${Math.round(c.amount * 100)}%`);
          break;
        }
        case 'set_loop': p = { ...p, loop: { enabled: c.enabled, start: meter().barToBeat(c.from_bar - 1), end: meter().barToBeat(c.to_bar) } }; applied.push(`Loop bars ${c.from_bar}–${c.to_bar}`); break;
        case 'add_marker': p = { ...p, markers: [...p.markers, { id: uid('m'), beat: meter().barToBeat(c.bar - 1), name: c.name, color: '#3dc6ff' }] }; applied.push(`Marker "${c.name}" at bar ${c.bar}`); break;
        case 'automate': {
          const t = oneTrack(p, c.track, ctx);
          const okTarget = ['volume', 'pan', 'inst.cutoff', 'inst.resonance'].includes(c.target) || /^send\.|^fx\./.test(c.target);
          if (!okTarget) throw new Error(`Unsupported automation target "${c.target}"`);
          const pts = c.points.map((x) => ({ beat: meter().barToBeat(x.bar - 1), value: x.value })).sort((a, b) => a.beat - b.beat);
          p = updateTrack(p, t.id, (x) => ({ ...x, automation: [...x.automation.filter((a) => a.target !== c.target), { id: uid('au'), target: c.target, enabled: true, points: pts }] }));
          applied.push(`Automated ${t.name} ${c.target}`);
          break;
        }
      }
    } catch (e) {
      errors.push(`${c.op}: ${(e as Error).message}`);
    }
  }
  return { project: p, applied, errors, messages };
}
