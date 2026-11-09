import { uid } from '../util/id';
import { makeEffect, masteringChain } from './effects';
import { emptySamplerInstrument, instrumentFromPreset } from './presets';
import {
  PROJECT_FORMAT, PROJECT_VERSION, ProjectSchema,
  type Clip, type Note, type Project, type ReturnBus, type Track, type TrackRole,
} from './schema';

export const TRACK_COLORS = ['#ff8a3d', '#ffc23d', '#9be15d', '#3ddc97', '#3dc6ff', '#5d8bff', '#a17bff', '#ff6fb5', '#ff5d5d', '#c8a27a', '#7fd1c7', '#e0e0e0'];

export function newNote(pitch: number, start: number, duration: number, velocity = 0.8, lyric?: string): Note {
  const n: Note = { id: uid('n'), pitch: Math.max(0, Math.min(127, Math.round(pitch))), start: Math.max(0, start), duration: Math.max(1 / 256, duration), velocity: Math.max(0, Math.min(1, velocity)) };
  if (lyric) n.lyric = lyric;
  return n;
}

export function newMidiClip(start: number, length: number, notes: Note[] = [], name = 'Clip', sectionId: string | null = null): Clip {
  return {
    id: uid('c'), kind: 'midi', name, start, length, offset: 0, loop: false, contentLength: length,
    color: null, notes, swing: 0, muted: false, sectionId, audio: null,
  };
}

export function newAudioClip(start: number, lengthBeats: number, assetId: string, name: string): Clip {
  return {
    id: uid('c'), kind: 'audio', name, start, length: lengthBeats, offset: 0, loop: false, contentLength: lengthBeats,
    color: null, notes: [], swing: 0, muted: false, sectionId: null,
    audio: { assetId, gain: 0, fadeIn: 0.005, fadeOut: 0.01, playbackRate: 1, startSec: 0, reverse: false },
  };
}

export interface NewTrackOpts { name?: string; role?: TrackRole; preset?: string; color?: string; type?: Track['type'] }

export function newTrack(opts: NewTrackOpts = {}, index = 0): Track {
  const type: Track['type'] = opts.type ?? (opts.preset?.startsWith('kit-') ? 'drums' : 'instrument');
  const instrument = type === 'audio'
    ? { ...instrumentFromPreset('synth-piano'), kind: 'none' as const }
    : opts.preset === 'sampler' ? emptySamplerInstrument() : instrumentFromPreset(opts.preset ?? (type === 'drums' ? 'kit-electronic' : 'synth-piano'));
  return {
    id: uid('t'),
    name: opts.name ?? (type === 'drums' ? 'Drums' : type === 'audio' ? 'Audio' : 'Instrument'),
    type,
    role: opts.role ?? (type === 'drums' ? 'drums' : type === 'audio' ? 'audio' : 'other'),
    color: opts.color ?? TRACK_COLORS[index % TRACK_COLORS.length],
    instrument,
    volume: -6,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    monitor: false,
    effects: [],
    sends: [],
    output: 'master',
    groupId: null,
    clips: [],
    automation: [],
    height: 64,
    pattern: null,
  };
}

export function defaultReturns(): ReturnBus[] {
  return [
    { id: 'ret-reverb', name: 'Reverb', color: '#5d8bff', volume: 0, mute: false, effects: [makeEffect('reverb', { decay: 2.8, mix: 1, predelay: 0.025 })] },
    { id: 'ret-delay', name: 'Delay', color: '#3ddc97', volume: -3, mute: false, effects: [makeEffect('delay', { time: 0.75, feedback: 0.35, mix: 1 })] },
  ];
}

export function newProject(name = 'Untitled Song'): Project {
  const now = Date.now();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: uid('p'),
    name,
    createdAt: now,
    updatedAt: now,
    bpm: 120,
    tempoChanges: [],
    timeSignature: { numerator: 4, denominator: 4 },
    signatureChanges: [],
    key: { tonic: 0, mode: 'major' },
    sampleRate: 48000,
    tracks: [],
    returns: defaultReturns(),
    groups: [],
    master: { volume: 0, effects: masteringChain('clean'), preset: 'clean' },
    markers: [],
    sections: [],
    chords: [],
    loop: { enabled: false, start: 0, end: 16 },
    lyrics: { sections: [], vocalStyle: { voice: 'any', delivery: 'natural' } },
    generation: null,
    style: null,
    metronome: { enabled: false, countInBars: 1, volume: 0.6 },
    notes: '',
  };
}

/** Length of the arrangement in beats (end of last clip / section). */
export function projectEndBeat(p: Project): number {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.length);
  for (const s of p.sections) end = Math.max(end, s.start + s.length);
  return end;
}

export class ProjectValidationError extends Error {
  constructor(message: string, public issues: string[]) { super(message); }
}

/** Validate + upgrade any loaded JSON into a Project. Throws ProjectValidationError with readable issues. */
export function parseProject(data: unknown): Project {
  const migrated = migrateProject(data);
  const res = ProjectSchema.safeParse(migrated);
  if (!res.success) {
    const issues = res.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ProjectValidationError('Project file failed validation', issues);
  }
  return res.data;
}

/** Schema migrations. Version 1 is the first released format; future versions upgrade here. */
export function migrateProject(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const d = data as Record<string, unknown>;
  if (d.format !== PROJECT_FORMAT) return data;
  // v1: nothing to migrate yet, but fill optional newer fields defensively
  const base = newProject();
  for (const k of Object.keys(base) as (keyof Project)[]) if (d[k] === undefined) (d as any)[k] = (base as any)[k];
  return d;
}

export function serializeProject(p: Project): string {
  return JSON.stringify(p);
}

export function sendsForRole(role: TrackRole, returns: ReturnBus[]) {
  const rev = returns.find((r) => r.id === 'ret-reverb');
  const del = returns.find((r) => r.id === 'ret-delay');
  const s: Track['sends'] = [];
  const revAmt: Partial<Record<TrackRole, number>> = { melody: 0.25, countermelody: 0.3, pad: 0.4, chords: 0.22, strings: 0.35, brass: 0.25, woodwinds: 0.3, arp: 0.25, vocal: 0.22, 'backing-vocal': 0.35, harmony: 0.3, drums: 0.08, percussion: 0.15, fx: 0.4, ostinato: 0.2 };
  const delAmt: Partial<Record<TrackRole, number>> = { melody: 0.12, arp: 0.18, vocal: 0.1, countermelody: 0.08 };
  if (rev && revAmt[role]) s.push({ returnId: rev.id, level: revAmt[role]! });
  if (del && delAmt[role]) s.push({ returnId: del.id, level: delAmt[role]! });
  return s;
}
