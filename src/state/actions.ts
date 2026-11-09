/** High-level user actions shared by toolbar, panels, shortcuts and the beginner screen. */
import { engine } from '../audio/engine';
import { projectAssetIds } from '../audio/assets';
import { renderProject, RenderAbortedError } from '../audio/render';
import { composeFromSpec, composeLocal, planFromSettings } from '../compose/composer';
import * as T from '../compose/transform';
import { applyCommands, type Command } from '../ai/commands';
import { claudeAssist, claudeCompose, claudeLyrics, health, renderVocals } from '../ai/client';
import { projectContext } from '../ai/context';
import { localAssistant } from '../ai/localAssistant';
import { analyze, normalizePeak, type Analysis } from '../export/analysis';
import { encodeWav, type BitDepth } from '../export/wav';
import { encodeMp3 } from '../export/mp3';
import { midiToProject, midiToTracks, parseMidi, projectToMidi } from '../midi/midi';
import { duplicateClip, splitClip } from '../model/clipOps';
import { newAudioClip, newProject, newTrack, parseProject, serializeProject, TRACK_COLORS } from '../model/factory';
import { DRUM_PIECES, emptySamplerInstrument, instrumentFromPreset } from '../model/presets';
import type { Clip, GenerationSettings, Project, SampleZone, Track } from '../model/schema';
import { MeterMap, TempoMap } from '../model/tempo';
import { deleteProject, lastProjectId, loadProject } from '../storage/db';
import { parseNoteName } from '../theory/theory';
import { uid } from '../util/id';
import { getProject, saveNow, toast, useStudio } from './store';

const S = () => useStudio.getState();

export function download(data: BlobPart | Blob, filename: string, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const safeName = (s: string) => s.replace(/[^\w\- ()]+/g, '').trim().replace(/\s+/g, '_') || 'aims';

// ---------------- transport ----------------
export async function togglePlay() {
  if (engine.playing) return stop(false);
  try {
    await engine.play(S().cursorBeat);
    S().set({ playing: true });
  } catch (e) { toast('error', `Playback failed: ${(e as Error).message}`); }
}
export function stop(rewind = false) {
  const pos = engine.positionBeat();
  engine.stop();
  S().set({ playing: false, recording: false, cursorBeat: rewind ? (S().project.loop.enabled ? S().project.loop.start : 0) : pos });
}
export function seek(beat: number) {
  const b = Math.max(0, beat);
  S().set({ cursorBeat: b });
  if (engine.playing) void engine.play(b);
}
engine.onEnded = () => useStudio.setState({ playing: false, cursorBeat: 0 });

// ---------------- generation ----------------
let abortCtl: AbortController | null = null;
export function cancelBusy() { abortCtl?.abort(); }

export async function generate(settings: GenerationSettings, opts: { open?: boolean } = {}): Promise<boolean> {
  S().set({ busy: 'Composing…', genSettings: settings });
  try {
    let result;
    if (settings.engine === 'claude') {
      const h = await health(true);
      if (!h.claude) throw new Error('Claude is not configured on the server (set ANTHROPIC_API_KEY). Switch the engine to "Local" to compose offline.');
      abortCtl = new AbortController();
      S().set({ busy: `Claude is composing (${h.model})…` });
      const { spec: draft } = planFromSettings(settings);
      const spec = await claudeCompose(settings, draft, abortCtl.signal);
      result = composeFromSpec(spec, settings);
    } else {
      await new Promise((r) => setTimeout(r, 20)); // let the UI paint the busy state
      result = composeLocal(settings);
    }
    const prev = getProject();
    const p = { ...result.project, id: prev.tracks.length ? result.project.id : prev.id };
    S().load(p, 'Generate song', true);
    S().set({ cursorBeat: 0, chat: [...S().chat, { role: 'assistant', text: result.report.join('\n'), engine: settings.engine }] });
    toast('success', `Composed "${p.name}" — ${p.tracks.length} parts, ${p.sections.length} sections. Press Space to play.`);
    if (opts.open !== false) S().set({ mode: S().mode });
    return true;
  } catch (e) {
    if ((e as Error).name !== 'AbortError') toast('error', (e as Error).message);
    return false;
  } finally {
    S().set({ busy: null });
    abortCtl = null;
  }
}

/** Range for AI actions: user selection, else selected section(s) of the cursor, else whole song. */
function targetSections(p: Project): number[] {
  const sel = S().selection;
  if (sel) return T.sectionsInRange(p, sel.from, sel.to);
  return p.sections.map((_, i) => i);
}

export type AiAction =
  | 'regenerate' | 'extend' | 'remix' | 'improve-melody' | 'improve-chords' | 'improve-rhythm' | 'variation' | 'cinematic'
  | 'energy-up' | 'soften' | 'new-ending' | 'new-intro' | 'harmonies' | 'humanize';

export function aiAction(action: AiAction, arg?: string) {
  const seed = Math.floor(Math.random() * 1e9);
  const labels: Record<AiAction, string> = {
    regenerate: 'Regenerate', extend: 'Extend song', remix: 'Remix', 'improve-melody': 'Improve melody', 'improve-chords': 'Improve chords',
    'improve-rhythm': 'Improve rhythm', variation: 'Create variation', cinematic: 'Make more cinematic', 'energy-up': 'Increase energy',
    soften: 'Soften arrangement', 'new-ending': 'New ending', 'new-intro': 'New introduction', harmonies: 'Generate harmonies', humanize: 'Humanize',
  };
  if (!getProject().tracks.length && action !== 'regenerate') return toast('warn', 'Generate or create some music first.');
  if (action === 'regenerate' && !S().selection) {
    // whole song with a fresh seed
    void generate({ ...S().genSettings, seed });
    return;
  }
  S().commit(labels[action] + (S().selection ? ' (selection)' : ''), (p0) => {
    const p = T.ensureStyle(T.ensureSections(p0));
    const secs = targetSections(p);
    const sel = S().selection;
    switch (action) {
      case 'regenerate': return T.regenerateSections(p, secs, { roles: 'all', seed });
      case 'extend': return T.extendSong(p, Number(arg ?? 8), seed);
      case 'remix': return T.remix(p, seed);
      case 'improve-melody': return T.improveMelody(p, secs, seed);
      case 'improve-chords': return T.improveChords(p, secs, seed);
      case 'improve-rhythm': return T.improveRhythm(p, secs, seed);
      case 'variation': return T.createVariation(p, secs, seed);
      case 'cinematic': return T.makeCinematic(p, seed);
      case 'energy-up': return T.changeEnergy(p, secs, 0.2, seed);
      case 'soften': return T.softenArrangement(p, secs, seed);
      case 'new-ending': return T.newIntroOrEnding(p, 'outro', seed);
      case 'new-intro': return T.newIntroOrEnding(p, 'intro', seed);
      case 'harmonies': return T.generateHarmonies(p, secs, seed);
      case 'humanize': return T.humanize(p, sel?.from ?? 0, sel?.to ?? 1e9, 0.6, seed);
    }
  });
  toast('success', `${labels[action]} applied — Ctrl+Z to undo.`);
}

export function changeGenre(genre: string) {
  S().commit(`Change genre → ${genre}`, (p) => T.changeGenre(T.ensureSections(p), genre, Math.floor(Math.random() * 1e9)));
}
export function addInstrumentAI(what: string) {
  S().commit(`Add ${what}`, (p) => T.addInstrument(p, what, Math.floor(Math.random() * 1e9)));
}
export function removeInstrumentsAI(what: string) {
  const p = getProject();
  const found = T.findTracks(p, what);
  if (!found.length) return toast('warn', `No track matches "${what}"`);
  S().commit(`Remove ${what}`, (pp) => T.removeInstruments(pp, (t) => found.some((f) => f.id === t.id)));
}

/** Natural-language instruction on the selection (or whole song). Uses Claude if available. */
export async function runInstruction(text: string, preferClaude = true) {
  const p = getProject();
  const sel = S().selection;
  S().set({ chat: [...S().chat, { role: 'user', text }], busy: 'Thinking…' });
  try {
    const h = await health();
    let reply: string;
    let commands: Command[];
    let rejected: string[] = [];
    let eng: 'claude' | 'local' = 'local';
    if (preferClaude && h.claude) {
      abortCtl = new AbortController();
      const history = S().chat.slice(-8, -1).map((m) => ({ role: m.role, text: m.text }));
      const res = await claudeAssist(text, projectContext(p, sel, S().selectedTrackIds), history, abortCtl.signal);
      reply = res.reply; commands = res.commands; rejected = res.rejected; eng = 'claude';
    } else {
      const res = localAssistant(text, p, !!sel);
      reply = res.reply; commands = res.commands;
    }
    let applied: string[] = [];
    let errors: string[] = [...rejected];
    if (commands.length) {
      const res = applyCommands(p, commands, { selection: sel, selectedTrackIds: S().selectedTrackIds });
      applied = res.applied;
      errors = errors.concat(res.errors);
      if (res.messages.length) reply += '\n' + res.messages.join('\n');
      if (applied.length) S().commit(`AI: ${text.slice(0, 40)}`, () => res.project);
    }
    S().set({ chat: [...S().chat, { role: 'assistant', text: reply, applied, errors, engine: eng }] });
  } catch (e) {
    if ((e as Error).name !== 'AbortError') S().set({ chat: [...S().chat, { role: 'assistant', text: `Error: ${(e as Error).message}`, engine: 'local' }] });
  } finally {
    S().set({ busy: null });
    abortCtl = null;
  }
}

export async function writeLyricsAI(topic: string) {
  const p = getProject();
  const h = await health();
  if (!h.claude) {
    S().commit('Write lyrics (local templates)', (pp) => T.alignVocals(T.writeLocalLyrics(pp, topic, Math.floor(Math.random() * 1e9)), 1));
    toast('info', 'Wrote simple template-based lyrics locally. Configure Claude on the server for real lyric writing.');
    return;
  }
  S().set({ busy: 'Claude is writing lyrics…' });
  try {
    const bpb = (p.timeSignature.numerator * 4) / p.timeSignature.denominator;
    const vocal = p.tracks.find((t) => t.role === 'vocal');
    const secs = p.sections.filter((s) => !vocal || vocal.clips.some((c) => c.sectionId === s.id) || ['verse', 'chorus', 'prechorus', 'bridge'].includes(s.kind));
    const out = await claudeLyrics(secs.map((s) => ({ section: s.name, kind: s.kind, lines: Math.max(2, Math.floor(s.length / bpb / 2)) })), p.style?.mood ?? 'neutral', topic, p.lyrics.vocalStyle.voice);
    S().commit('Write lyrics (Claude)', (pp) => T.alignVocals({
      ...pp,
      lyrics: { ...pp.lyrics, sections: out.map((o) => ({ id: uid('l'), label: o.section, text: o.text, sectionId: pp.sections.find((s) => s.name === o.section)?.id ?? null })) },
    }, 1));
  } catch (e) { toast('error', (e as Error).message); } finally { S().set({ busy: null }); }
}

// ---------------- vocal provider ----------------
export async function renderVocalWithProvider() {
  const p = getProject();
  const h = await health(true);
  if (!h.vocalProvider) return toast('warn', 'No vocal provider configured on the server. Record or import a vocal instead (see README → Vocal providers).');
  const vocal = p.tracks.find((t) => t.role === 'vocal');
  const text = p.lyrics.sections.map((l) => l.text).join('\n');
  S().set({ busy: `Rendering with ${h.vocalProvider.name}…` });
  try {
    const notes = vocal ? vocal.clips.flatMap((c) => c.notes.map((n) => ({ pitch: n.pitch, start: c.start + n.start - c.offset, duration: n.duration, lyric: n.lyric ?? '' }))) : [];
    const { blob, kind } = await renderVocals({ text, notes, bpm: p.bpm, voice: p.lyrics.vocalStyle.voice, delivery: p.lyrics.vocalStyle.delivery });
    const { id, buffer } = await engine.assets.importFile(blob, `${h.vocalProvider.name} ${kind}`, 'render');
    const startBeat = p.sections.find((s) => s.kind === 'verse')?.start ?? 0;
    addAudioClipToNewTrack(id, buffer, startBeat, kind === 'speech' ? 'Spoken Word (TTS)' : 'AI Vocal');
    toast('success', kind === 'speech' ? 'Added spoken-word audio (text-to-speech — this is speech, not singing).' : 'Added rendered vocal audio from the provider.');
  } catch (e) { toast('error', (e as Error).message); } finally { S().set({ busy: null }); }
}

// ---------------- tracks & clips ----------------
export function addTrack(kind: 'instrument' | 'drums' | 'audio' | 'sampler', preset?: string) {
  S().commit('Add track', (p) => {
    const t = kind === 'audio' ? newTrack({ type: 'audio', name: `Audio ${p.tracks.filter((x) => x.type === 'audio').length + 1}` }, p.tracks.length)
      : kind === 'sampler' ? newTrack({ preset: 'sampler', name: 'Sampler', role: 'other' }, p.tracks.length)
      : newTrack({ preset: preset ?? (kind === 'drums' ? 'kit-electronic' : 'synth-piano'), role: kind === 'drums' ? 'drums' : 'other' }, p.tracks.length);
    if (kind === 'sampler') t.instrument = emptySamplerInstrument();
    S().set({ selectedTrackIds: [t.id] });
    return { ...p, tracks: [...p.tracks, t] };
  });
}
export function deleteTracks(ids: string[]) {
  if (!ids.length) return;
  S().commit('Delete track', (p) => ({ ...p, tracks: p.tracks.filter((t) => !ids.includes(t.id)) }));
}
export function duplicateTrack(id: string) {
  S().commit('Duplicate track', (p) => {
    const i = p.tracks.findIndex((t) => t.id === id);
    if (i < 0) return p;
    const src = p.tracks[i];
    const copy: Track = { ...structuredClone(src), id: uid('t'), name: `${src.name} copy`, clips: src.clips.map((c) => duplicateClip(c, c.start)), solo: false };
    return { ...p, tracks: [...p.tracks.slice(0, i + 1), copy, ...p.tracks.slice(i + 1)] };
  });
}
export function updateTrack(id: string, patch: Partial<Track>, label = 'Edit track') {
  S().commit(label, (p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
}
export function setInstrumentPreset(trackId: string, presetId: string) {
  S().commit('Change instrument', (p) => ({
    ...p,
    tracks: p.tracks.map((t) => {
      if (t.id !== trackId) return t;
      const inst = instrumentFromPreset(presetId);
      const keepPieces = t.instrument.kind === 'drumkit' && inst.kind === 'drumkit' ? t.instrument.pieces : inst.pieces;
      return { ...t, instrument: { ...inst, pieces: keepPieces }, type: inst.kind === 'drumkit' ? 'drums' : 'instrument' };
    }),
  }));
}
export function groupTracks(ids: string[], name = 'Group') {
  if (ids.length < 2) return toast('warn', 'Select two or more tracks (Ctrl-click headers) to group them.');
  S().commit('Group tracks', (p) => {
    const g = { id: uid('g'), name, color: TRACK_COLORS[p.groups.length % TRACK_COLORS.length], collapsed: false };
    return { ...p, groups: [...p.groups, g], tracks: p.tracks.map((t) => (ids.includes(t.id) ? { ...t, groupId: g.id, color: g.color } : t)) };
  });
}

function mapClips(p: Project, fn: (c: Clip, t: Track) => Clip | Clip[] | null): Project {
  return {
    ...p,
    tracks: p.tracks.map((t) => ({
      ...t,
      clips: t.clips.flatMap((c) => {
        const r = fn(c, t);
        return r === null ? [] : Array.isArray(r) ? r : [r];
      }),
    })),
  };
}
export function deleteSelectedClips() {
  const ids = S().selectedClipIds;
  if (!ids.length) return;
  S().commit('Delete clips', (p) => mapClips(p, (c) => (ids.includes(c.id) ? null : c)));
  S().set({ selectedClipIds: [] });
}
export function duplicateSelectedClips() {
  const ids = S().selectedClipIds;
  if (!ids.length) return;
  const newIds: string[] = [];
  S().commit('Duplicate clips', (p) => {
    const sel = p.tracks.flatMap((t) => t.clips.filter((c) => ids.includes(c.id)));
    const span = Math.max(...sel.map((c) => c.start + c.length)) - Math.min(...sel.map((c) => c.start));
    return mapClips(p, (c) => {
      if (!ids.includes(c.id)) return c;
      const d = duplicateClip(c, c.start + span);
      newIds.push(d.id);
      return [c, d];
    });
  });
  S().set({ selectedClipIds: newIds });
}
export function splitAt(beat: number, clipIds?: string[]) {
  const ids = clipIds ?? S().selectedClipIds;
  S().commit('Split clip', (p) => mapClips(p, (c) => {
    if ((ids.length && !ids.includes(c.id)) || beat <= c.start || beat >= c.start + c.length) return c;
    return splitClip(c, beat) ?? c;
  }));
}
export function copySelection() {
  const ids = S().selectedClipIds;
  const p = getProject();
  const clips = p.tracks.flatMap((t) => t.clips.filter((c) => ids.includes(c.id)).map((c) => ({ trackId: t.id, clip: c })));
  if (clips.length) { S().set({ clipboard: { kind: 'clips', data: clips } }); toast('info', `Copied ${clips.length} clip(s)`); }
}
export function pasteAtCursor() {
  const cb = S().clipboard;
  if (!cb || cb.kind !== 'clips') return;
  const items = cb.data as { trackId: string; clip: Clip }[];
  const minStart = Math.min(...items.map((i) => i.clip.start));
  const at = S().cursorBeat;
  S().commit('Paste clips', (p) => ({
    ...p,
    tracks: p.tracks.map((t) => {
      const mine = items.filter((i) => i.trackId === t.id);
      if (!mine.length) return t;
      return { ...t, clips: [...t.clips, ...mine.map((i) => duplicateClip(i.clip, at + i.clip.start - minStart))].sort((a, b) => a.start - b.start) };
    }),
  }));
}

// ---------------- import ----------------
export async function importFiles(files: FileList | File[], targetTrackId?: string, atBeat?: number) {
  for (const f of Array.from(files)) {
    const name = f.name;
    try {
      if (/\.(mid|midi)$/i.test(name)) {
        const m = parseMidi(await f.arrayBuffer());
        const p = getProject();
        if (!p.tracks.length) {
          S().load(midiToProject(m, name.replace(/\.\w+$/, '')), 'Import MIDI', true);
        } else {
          const tracks = midiToTracks(m, p.tracks.length);
          S().commit('Import MIDI', (pp) => ({ ...pp, tracks: [...pp.tracks, ...tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, start: c.start + (atBeat ?? 0) })) }))] }));
        }
        toast('success', `Imported MIDI "${name}" (${m.tracks.length} tracks)`);
      } else if (/\.json$/i.test(name) || /\.aims$/i.test(name)) {
        const p = parseProject(JSON.parse(await f.text()));
        await engine.assets.ensure(projectAssetIds(p));
        const missing = [...projectAssetIds(p)].filter((id) => !engine.assets.has(id));
        S().load({ ...p, id: uid('p') }, 'Import project', true);
        toast(missing.length ? 'warn' : 'success', missing.length ? `Imported "${p.name}", but ${missing.length} audio file(s) are not in this browser's storage (project files contain notes/settings, not audio).` : `Imported project "${p.name}"`);
      } else {
        const { id, buffer } = await engine.assets.importFile(f, name, 'import');
        addAudioClipToNewTrack(id, buffer, atBeat ?? S().cursorBeat, name.replace(/\.\w+$/, ''), targetTrackId);
        toast('success', `Imported audio "${name}" (${buffer.duration.toFixed(1)}s, ${buffer.sampleRate} Hz)`);
      }
    } catch (e) {
      toast('error', `${name}: ${(e as Error).message}`);
    }
  }
}

export function addAudioClipToNewTrack(assetId: string, buffer: AudioBuffer, startBeat: number, name: string, targetTrackId?: string) {
  S().commit('Add audio clip', (p) => {
    const tm = TempoMap.fromProject(p);
    const beats = tm.secToBeat(tm.beatToSec(startBeat) + buffer.duration) - startBeat;
    const clip = newAudioClip(startBeat, beats, assetId, name);
    const target = targetTrackId ? p.tracks.find((t) => t.id === targetTrackId && t.type === 'audio') : undefined;
    if (target) return { ...p, tracks: p.tracks.map((t) => (t.id === target.id ? { ...t, clips: [...t.clips, clip] } : t)) };
    const t = newTrack({ type: 'audio', name, role: 'audio' }, p.tracks.length);
    t.volume = -3;
    t.clips = [clip];
    return { ...p, tracks: [...p.tracks, t] };
  });
}

/** Create a sampled instrument from audio files. Note names in file names (e.g. "Piano_C4.wav") set the root pitch. */
export async function importInstrumentSamples(files: FileList | File[], trackId?: string) {
  const zones: SampleZone[] = [];
  for (const f of Array.from(files)) {
    try {
      const { id } = await engine.assets.importFile(f, f.name, 'sample');
      const m = /([A-Ga-g][#b]?-?\d)(?!.*[A-Ga-g][#b]?-?\d)/.exec(f.name.replace(/\.\w+$/, ''));
      const root = (m && parseNoteName(m[1])) ?? 60;
      zones.push({ assetId: id, name: f.name, rootPitch: root, loPitch: 0, hiPitch: 127, loVel: 0, hiVel: 1, gain: 0, loop: false });
    } catch (e) { toast('error', `${f.name}: ${(e as Error).message}`); }
  }
  if (!zones.length) return;
  // spread key ranges between neighbouring roots
  zones.sort((a, b) => a.rootPitch - b.rootPitch);
  zones.forEach((z, i) => {
    z.loPitch = i === 0 ? 0 : Math.floor((zones[i - 1].rootPitch + z.rootPitch) / 2) + 1;
    z.hiPitch = i === zones.length - 1 ? 127 : Math.floor((z.rootPitch + zones[i + 1].rootPitch) / 2);
  });
  S().commit('Import sampled instrument', (p) => {
    const existing = trackId ? p.tracks.find((t) => t.id === trackId) : undefined;
    if (existing && existing.instrument.kind === 'sampler') return { ...p, tracks: p.tracks.map((t) => (t.id === existing.id ? { ...t, instrument: { ...t.instrument, zones: [...t.instrument.zones, ...zones] } } : t)) };
    const t = newTrack({ preset: 'sampler', name: zones.length === 1 ? zones[0].name.replace(/\.\w+$/, '') : 'Sampled Instrument', role: 'other' }, p.tracks.length);
    t.instrument = { ...emptySamplerInstrument(), zones };
    S().set({ selectedTrackIds: [t.id] });
    return { ...p, tracks: [...p.tracks, t] };
  });
  toast('success', `Created sampled instrument with ${zones.length} zone(s)`);
}

export async function replaceDrumSample(trackId: string, pitch: number, file: File) {
  try {
    const { id } = await engine.assets.importFile(file, file.name, 'sample');
    S().commit('Replace drum sample', (p) => ({ ...p, tracks: p.tracks.map((t) => (t.id !== trackId ? t : { ...t, instrument: { ...t.instrument, source: 'sampled', pieces: { ...t.instrument.pieces, [pitch]: { ...(t.instrument.pieces[pitch] ?? { tune: 0, decay: 1, level: 1, pan: 0 }), sampleAssetId: id } } } })) }));
    toast('success', `${DRUM_PIECES.find((d) => d.pitch === pitch)?.name ?? pitch} now plays "${file.name}"`);
  } catch (e) { toast('error', (e as Error).message); }
}

// ---------------- export ----------------
export interface ExportOptions { format: 'wav' | 'mp3'; sampleRate: 44100 | 48000; bitDepth: BitDepth; kbps: number; normalize: boolean; range: 'song' | 'loop' | 'selection'; stems: boolean; stemsWithMaster: boolean }
export interface ExportProgress { fraction: number; label: string }

export async function exportAudio(o: ExportOptions, onProgress: (p: ExportProgress) => void, signal: AbortSignal): Promise<{ files: string[]; analysis: Analysis | null }> {
  const p = getProject();
  if (!p.tracks.length) throw new Error('Nothing to export — the project has no tracks.');
  await engine.assets.ensure(projectAssetIds(p));
  const missing = [...projectAssetIds(p)].filter((id) => !engine.assets.has(id));
  if (missing.length) toast('warn', `${missing.length} audio file(s) are missing and will be silent in the export.`);
  let startBeat: number | undefined, endBeat: number | undefined;
  if (o.range === 'loop') { startBeat = p.loop.start; endBeat = p.loop.end; }
  if (o.range === 'selection' && S().selection) { startBeat = S().selection!.from; endBeat = S().selection!.to; }
  const jobs: { name: string; solo: Set<string> | null; bypass: boolean }[] = o.stems
    ? p.tracks.filter((t) => !t.mute && t.clips.length).map((t) => ({ name: `${safeName(p.name)}_stem_${safeName(t.name)}`, solo: new Set([t.id]), bypass: !o.stemsWithMaster }))
    : [{ name: safeName(p.name), solo: null, bypass: false }];
  const files: string[] = [];
  let lastAnalysis: Analysis | null = null;
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    const base = i / jobs.length;
    onProgress({ fraction: base, label: `Rendering ${o.stems ? `stem ${i + 1}/${jobs.length}` : 'mix'}…` });
    const buf = await renderProject(p, engine.assets, {
      sampleRate: o.sampleRate, startBeat, endBeat, soloTrackIds: j.solo, bypassMaster: j.bypass, signal,
      onProgress: (f) => onProgress({ fraction: base + (f * 0.8) / jobs.length, label: `Rendering ${o.stems ? `stem ${i + 1}/${jobs.length}` : 'mix'}… ${Math.round(f * 100)}%` }),
    });
    if (signal.aborted) throw new RenderAbortedError();
    if (o.normalize) normalizePeak(buf, -1);
    const a = analyze(buf);
    lastAnalysis = a;
    if (a.peakDb < -90 && !o.stems) throw new Error('The render is silent — check that tracks are not all muted.');
    onProgress({ fraction: base + 0.85 / jobs.length, label: o.format === 'mp3' ? 'Encoding MP3…' : 'Encoding WAV…' });
    if (o.format === 'mp3') {
      const blob = await encodeMp3(buf, o.kbps, (f) => onProgress({ fraction: base + (0.85 + 0.15 * f) / jobs.length, label: `Encoding MP3… ${Math.round(f * 100)}%` }));
      download(blob, `${j.name}.mp3`);
      files.push(`${j.name}.mp3`);
    } else {
      download(encodeWav(buf, o.bitDepth), `${j.name}.wav`, 'audio/wav');
      files.push(`${j.name}.wav`);
    }
  }
  onProgress({ fraction: 1, label: 'Done' });
  return { files, analysis: lastAnalysis };
}

export function exportMidi(trackIds?: string[]) {
  const p = getProject();
  download(projectToMidi(p, trackIds) as BlobPart, `${safeName(p.name)}.mid`, 'audio/midi');
}
export function exportProjectFile() {
  const p = getProject();
  download(serializeProject(p), `${safeName(p.name)}.aims.json`, 'application/json');
}

// ---------------- project management ----------------
export async function newEmptyProject(template?: 'empty' | 'beat' | 'band' | 'orchestra' | 'podcast') {
  let p = newProject(template && template !== 'empty' ? `${template[0].toUpperCase()}${template.slice(1)} template` : 'Untitled Song');
  const add = (preset: string, name: string, role: Track['role'], type?: Track['type']) => { p.tracks.push({ ...newTrack({ preset, name, role, type }, p.tracks.length) }); };
  if (template === 'beat') { add('kit-808', 'Drums', 'drums'); add('808-bass', '808', 'bass'); add('warm-epiano', 'Keys', 'chords'); add('bells', 'Melody', 'melody'); p.bpm = 90; }
  if (template === 'band') { add('kit-rock', 'Drums', 'drums'); add('pick-bass', 'Bass', 'bass'); add('dist-guitar', 'Guitar', 'chords'); add('synth-piano', 'Piano', 'chords'); add('vocal-guide', 'Vocal guide', 'vocal'); p.tracks.push(newTrack({ type: 'audio', name: 'Vocal Recording', role: 'audio' }, 5)); }
  if (template === 'orchestra') { add('violins', 'Violins', 'melody'); add('string-ensemble', 'Strings', 'strings'); add('cellos', 'Cellos', 'countermelody'); add('orch-basses', 'Basses', 'bass'); add('french-horns', 'Horns', 'brass'); add('kit-orchestral', 'Percussion', 'percussion'); p.bpm = 90; p.master.preset = 'cinematic'; }
  if (template === 'podcast') { p.tracks.push(newTrack({ type: 'audio', name: 'Host', role: 'audio' }, 0), newTrack({ type: 'audio', name: 'Guest', role: 'audio' }, 1), newTrack({ type: 'audio', name: 'Music Bed', role: 'audio' }, 2)); p.master.preset = 'podcast'; }
  if (p.master.preset !== 'clean') p = { ...p, master: { ...p.master, effects: (await import('../model/effects')).masteringChain(p.master.preset) } };
  await saveNow();
  S().load(p, 'New project');
  void S().refreshRecent();
}
export async function openProject(id: string) {
  try {
    await saveNow();
    const p = await loadProject(id);
    if (!p) return toast('error', 'Project not found in browser storage.');
    const valid = parseProject(p);
    await engine.assets.ensure(projectAssetIds(valid));
    S().load(valid);
    S().set({ cursorBeat: 0 });
    toast('success', `Opened "${valid.name}"`);
  } catch (e) { toast('error', `Could not open project: ${(e as Error).message}`); }
}
export async function duplicateProject() {
  const p = getProject();
  await saveNow();
  S().load({ ...structuredClone(p), id: uid('p'), name: `${p.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() });
  await saveNow();
  void S().refreshRecent();
  toast('success', 'Project duplicated');
}
export async function removeProject(id: string) {
  await deleteProject(id);
  void S().refreshRecent();
}
export async function restoreLastSession(): Promise<boolean> {
  try {
    const id = await lastProjectId();
    if (!id) return false;
    const p = await loadProject(id);
    if (!p) return false;
    const valid = parseProject(p);
    S().load(valid);
    void engine.assets.ensure(projectAssetIds(valid));
    return true;
  } catch (e) {
    console.warn('restore failed', e);
    toast('warn', 'Your last session could not be restored (it may be from an incompatible version).');
    return false;
  }
}

// ---------------- recording ----------------
export async function toggleRecord() {
  const s = S();
  if (s.recording) {
    try {
      const res = await engine.stopRecording();
      S().set({ recording: false, playing: false });
      if (!res) return toast('warn', 'Nothing was recorded.');
      const armed = getProject().tracks.find((t) => t.armed && t.type === 'audio');
      addAudioClipToNewTrack(res.assetId, res.buffer, res.startBeat, res.name, armed?.id);
      toast('success', `Recorded ${res.durationSec.toFixed(1)}s`);
    } catch (e) { toast('error', (e as Error).message); }
    return;
  }
  const p = getProject();
  let armed = p.tracks.find((t) => t.armed);
  if (!armed) {
    // auto-create an armed audio track
    const t = newTrack({ type: 'audio', name: 'Recording', role: 'audio' }, p.tracks.length);
    t.armed = true;
    S().commit('Add recording track', (pp) => ({ ...pp, tracks: [...pp.tracks, t] }));
    armed = t;
  }
  try {
    if (engine.playing) engine.stop();
    await engine.startRecording(armed.id, s.cursorBeat, p.metronome.countInBars);
    S().set({ recording: true, playing: true });
  } catch (e) { toast('error', (e as Error).message); }
}

export function barToBeat(bar: number) { return MeterMap.fromProject(getProject()).barToBeat(bar); }
