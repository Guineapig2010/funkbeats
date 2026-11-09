/**
 * Pure editing operations on clips and notes. All return new objects (no mutation),
 * which keeps undo/redo trivial and makes them easy to unit test.
 */
import { uid } from '../util/id';
import type { Clip, Note, Track } from './schema';
import { rng } from '../util/math';

export interface PlayedNote { pitch: number; start: number; duration: number; velocity: number; lyric?: string; noteId: string }

/** Expand a clip into absolute-beat note events honoring offset, looping, clip bounds and swing. */
export function expandClipNotes(clip: Clip): PlayedNote[] {
  if (clip.kind !== 'midi' || clip.muted) return [];
  const out: PlayedNote[] = [];
  const end = clip.start + clip.length;
  const cl = Math.max(1 / 64, clip.contentLength);
  const reps = clip.loop ? Math.ceil((clip.offset + clip.length) / cl) + 1 : 1;
  for (let r = 0; r < reps; r++) {
    for (const n of clip.notes) {
      if (clip.loop && n.start >= cl) continue;
      const rel = n.start + r * cl - clip.offset;
      if (rel < -1e-9) continue;
      let s = clip.start + rel + swingOffset(n.start, clip.swing);
      if (s >= end - 1e-9) continue;
      let dur = n.duration;
      if (clip.loop) dur = Math.min(dur, cl - n.start + 0.0001);
      dur = Math.min(dur, end - s);
      if (dur <= 0) continue;
      out.push({ pitch: n.pitch, start: s, duration: dur, velocity: n.velocity, lyric: n.lyric, noteId: n.id });
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Swing: delay notes that fall on odd 16th positions. swing=1 → triplet feel (1/12 beat delay). */
export function swingOffset(start: number, swing: number) {
  if (swing <= 0) return 0;
  const pos16 = start * 4;
  const nearest = Math.round(pos16);
  if (Math.abs(pos16 - nearest) > 0.08) return 0;
  return nearest % 2 === 1 ? swing * (1 / 12) : 0;
}

export function splitClip(clip: Clip, atBeat: number): [Clip, Clip] | null {
  const rel = atBeat - clip.start;
  if (rel <= 1e-6 || rel >= clip.length - 1e-6) return null;
  const left: Clip = { ...clip, length: rel };
  const right: Clip = { ...clip, id: uid('c'), start: atBeat, length: clip.length - rel, offset: clip.offset + rel };
  if (!clip.loop && clip.kind === 'midi') {
    // re-home notes so each half owns its own notes (keeps editing intuitive)
    left.notes = clip.notes.filter((n) => n.start < clip.offset + rel).map((n) => ({ ...n, duration: Math.min(n.duration, clip.offset + rel - n.start) }));
    right.notes = clip.notes.filter((n) => n.start >= clip.offset + rel).map((n) => ({ ...n, id: uid('n'), start: n.start - (clip.offset + rel) }));
    right.offset = 0;
    right.contentLength = right.length;
    left.contentLength = Math.max(left.contentLength, rel);
  }
  if (clip.kind === 'audio' && clip.audio) {
    right.audio = { ...clip.audio, fadeIn: 0.005 };
    left.audio = { ...clip.audio, fadeOut: 0.005 };
  }
  return [left, right];
}

export function duplicateClip(clip: Clip, newStart?: number): Clip {
  return { ...clip, id: uid('c'), start: newStart ?? clip.start + clip.length, notes: clip.notes.map((n) => ({ ...n, id: uid('n') })) };
}

/** Trim left edge to newStart (content stays in place on the timeline). */
export function trimClipStart(clip: Clip, newStart: number): Clip {
  const maxStart = clip.start + clip.length - 1 / 16;
  const minStart = clip.loop ? clip.start - clip.offset - 1e6 : clip.start - clip.offset;
  const s = Math.min(maxStart, Math.max(Math.max(0, minStart), newStart));
  const delta = s - clip.start;
  return { ...clip, start: s, length: clip.length - delta, offset: Math.max(0, clip.offset + delta) };
}

export function trimClipEnd(clip: Clip, newEnd: number): Clip {
  const len = Math.max(1 / 16, newEnd - clip.start);
  return { ...clip, length: len, contentLength: clip.loop ? clip.contentLength : Math.max(clip.contentLength, len + clip.offset) };
}

export function quantizeNotes(notes: Note[], grid: number, strength = 1, ends = false): Note[] {
  return notes.map((n) => {
    const q = Math.round(n.start / grid) * grid;
    const start = Math.max(0, n.start + (q - n.start) * strength);
    let duration = n.duration;
    if (ends) duration = Math.max(grid, Math.round(n.duration / grid) * grid);
    return { ...n, start, duration };
  });
}

export function transposeNotes(notes: Note[], semis: number): Note[] {
  return notes.map((n) => ({ ...n, pitch: Math.max(0, Math.min(127, n.pitch + semis)) }));
}

export function humanizeNotes(notes: Note[], amount: number, seed = 1): Note[] {
  const r = rng(seed);
  return notes.map((n) => ({
    ...n,
    start: Math.max(0, n.start + r.gauss(0, 0.012 * amount)),
    velocity: Math.max(0.05, Math.min(1, n.velocity + r.gauss(0, 0.07 * amount))),
    duration: Math.max(1 / 64, n.duration * (1 + r.gauss(0, 0.04 * amount))),
  }));
}

export function scaleVelocities(notes: Note[], factor: number, add = 0): Note[] {
  return notes.map((n) => ({ ...n, velocity: Math.max(0.02, Math.min(1, n.velocity * factor + add)) }));
}

export function legato(notes: Note[]): Note[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  return sorted.map((n, i) => {
    const next = sorted.slice(i + 1).find((m) => m.start > n.start + 1e-6);
    return next ? { ...n, duration: Math.max(n.duration, next.start - n.start) } : n;
  });
}

/** Remove notes overlapping same pitch (keeps the earlier one). */
export function dedupeNotes(notes: Note[]): Note[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const out: Note[] = [];
  for (const n of sorted) {
    const clash = out.find((m) => m.pitch === n.pitch && Math.abs(m.start - n.start) < 1e-4);
    if (!clash) out.push(n);
  }
  return out;
}

/** All notes of a track in absolute beats within [from, to) — used by AI context and region tools. */
export function trackNotesInRange(track: Track, from: number, to: number): PlayedNote[] {
  const out: PlayedNote[] = [];
  for (const c of track.clips) {
    if (c.start >= to || c.start + c.length <= from) continue;
    for (const n of expandClipNotes(c)) if (n.start >= from && n.start < to) out.push(n);
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Apply a note transform to every note in [from,to) (absolute beats) across a track's clips. */
export function mapNotesInRange(track: Track, from: number, to: number, fn: (notes: Note[], clip: Clip) => Note[]): Track {
  return {
    ...track,
    clips: track.clips.map((c) => {
      if (c.kind !== 'midi' || c.start >= to || c.start + c.length <= from) return c;
      const inside: Note[] = [];
      const outside: Note[] = [];
      for (const n of c.notes) {
        const abs = c.start + n.start - c.offset;
        (abs >= from - 1e-9 && abs < to - 1e-9 ? inside : outside).push(n);
      }
      if (!inside.length) return c;
      return { ...c, notes: [...outside, ...fn(inside, c)] };
    }),
  };
}

/** Remove clip content within [from,to): whole clips inside are removed, overlapping clips are split. */
export function clearRange(track: Track, from: number, to: number): Track {
  let clips: Clip[] = [];
  for (const c of track.clips) {
    const cEnd = c.start + c.length;
    if (cEnd <= from + 1e-9 || c.start >= to - 1e-9) { clips.push(c); continue; }
    let parts: Clip[] = [c];
    if (c.start < from) {
      const sp = splitClip(c, from);
      parts = sp ? [sp[0], sp[1]] : parts;
    }
    const keep: Clip[] = [];
    for (const p of parts) {
      if (p.start + p.length <= from + 1e-9) { keep.push(p); continue; }
      if (p.start + p.length > to + 1e-9) {
        const sp = splitClip(p, to);
        if (sp) keep.push(sp[1]);
      }
    }
    clips = clips.concat(keep);
  }
  return { ...track, clips };
}
