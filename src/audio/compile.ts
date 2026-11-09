/**
 * Compiles a project into time-sorted, seconds-based event lists. The scheduler
 * (live) and the offline renderer both consume this, so playback and export
 * produce the same events.
 */
import { expandClipNotes } from '../model/clipOps';
import { projectEndBeat } from '../model/factory';
import type { AutomationLane, Project } from '../model/schema';
import { TempoMap } from '../model/tempo';

export interface CNote { t: number; end: number; pitch: number; vel: number }
export interface CAudio { t: number; end: number; assetId: string; offsetSec: number; gain: number; fadeIn: number; fadeOut: number; rate: number; reverse: boolean }
export interface CLane { owner: string; target: string; points: { t: number; v: number }[] }
export interface CTrack { id: string; notes: CNote[]; audio: CAudio[]; instLanes: CLane[] }
export interface CompiledSong {
  tempo: TempoMap;
  tracks: CTrack[];
  lanes: CLane[];
  endSec: number;
  endBeat: number;
}

function laneToSec(owner: string, l: AutomationLane, tempo: TempoMap): CLane {
  const pts = [...l.points].sort((a, b) => a.beat - b.beat).map((p) => ({ t: tempo.beatToSec(p.beat), v: p.value }));
  return { owner, target: l.target, points: pts };
}

export function compileProject(p: Project): CompiledSong {
  const tempo = TempoMap.fromProject(p);
  const tracks: CTrack[] = [];
  const lanes: CLane[] = [];
  for (const t of p.tracks) {
    const notes: CNote[] = [];
    const audio: CAudio[] = [];
    for (const c of t.clips) {
      if (c.muted) continue;
      if (c.kind === 'midi') {
        for (const n of expandClipNotes(c)) {
          const ts = tempo.beatToSec(n.start);
          notes.push({ t: ts, end: tempo.beatToSec(n.start + n.duration), pitch: n.pitch, vel: n.velocity });
        }
      } else if (c.audio) {
        const a = c.audio;
        const bpm = tempo.bpmAt(c.start);
        const spb = 60 / bpm;
        const clipEnd = c.start + c.length;
        const reps = c.loop ? Math.ceil((c.offset + c.length) / c.contentLength) + 1 : 1;
        for (let r = 0; r < reps; r++) {
          // content-relative start of this repetition (beats) and its visible window
          const repStart = c.start - c.offset + r * c.contentLength;
          const from = Math.max(c.start, repStart);
          const to = Math.min(clipEnd, c.loop ? repStart + c.contentLength : clipEnd);
          if (to - from <= 1e-6) continue;
          const offBeats = from - repStart;
          audio.push({
            t: tempo.beatToSec(from),
            end: tempo.beatToSec(to),
            assetId: a.assetId,
            offsetSec: a.startSec + offBeats * spb * a.playbackRate,
            gain: a.gain,
            fadeIn: r === 0 ? a.fadeIn : 0.003,
            fadeOut: a.fadeOut,
            rate: a.playbackRate,
            reverse: a.reverse,
          });
        }
      }
    }
    notes.sort((a, b) => a.t - b.t);
    audio.sort((a, b) => a.t - b.t);
    const instLanes: CLane[] = [];
    for (const l of t.automation) {
      if (!l.enabled || l.points.length === 0) continue;
      const cl = laneToSec(t.id, l, tempo);
      if (l.target.startsWith('inst.')) instLanes.push(cl); else lanes.push(cl);
    }
    tracks.push({ id: t.id, notes, audio, instLanes });
  }
  const endBeat = Math.max(projectEndBeat(p), 1);
  return { tempo, tracks, lanes, endSec: tempo.beatToSec(endBeat), endBeat };
}

/** Linear interpolation of an automation lane at time t (seconds). */
export function laneValueAt(l: CLane, t: number): number {
  const pts = l.points;
  if (!pts.length) return 0;
  if (t <= pts[0].t) return pts[0].v;
  if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].v;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = pts[lo], b = pts[hi];
  const f = b.t - a.t < 1e-9 ? 1 : (t - a.t) / (b.t - a.t);
  return a.v + (b.v - a.v) * f;
}

export function lowerBound<T extends { t: number }>(arr: T[], t: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}
