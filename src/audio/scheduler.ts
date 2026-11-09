/**
 * Event scheduling. `scheduleWindow` pushes all events whose song-time falls in
 * [from, to) onto the audio clock. The live Transport calls it from a look-ahead
 * timer; the offline renderer calls it in chunks. Times are always derived from the
 * audio clock (never from timers), so playback does not drift.
 */
import type { CompiledSong } from './compile';
import { laneValueAt, lowerBound } from './compile';
import type { ProjectGraph } from './graph';

export interface WindowOpts {
  /** First window after a (re)start or loop wrap: start already-sounding audio clips and set automation start values. */
  first: boolean;
  /** Notes are cut at this song time (loop end). */
  cutAt?: number;
  metronome?: { enabled: boolean; volume: number; meterBeatsPerBar: (beat: number) => { beatInBar: number } } | null;
  duckSources?: Set<string>;
}

export function scheduleWindow(graph: ProjectGraph, song: CompiledSong, from: number, to: number, ctxOffset: number, o: WindowOpts) {
  if (to <= from) return;
  const duck = o.duckSources ?? graph.hasDuckers();
  for (const tr of song.tracks) {
    // notes
    const notes = tr.notes;
    for (let i = lowerBound(notes, from); i < notes.length && notes[i].t < to; i++) {
      const n = notes[i];
      let end = n.end;
      if (o.cutAt !== undefined && end > o.cutAt) end = o.cutAt;
      const dur = Math.max(0.005, end - n.t);
      let override: Partial<Record<'cutoff' | 'resonance', number>> | undefined;
      if (tr.instLanes.length) {
        override = {};
        for (const l of tr.instLanes) {
          if (l.target === 'inst.cutoff') override.cutoff = Math.max(20, Math.min(20000, laneValueAt(l, n.t)));
          if (l.target === 'inst.resonance') override.resonance = Math.max(0.1, Math.min(30, laneValueAt(l, n.t)));
        }
      }
      graph.playNote(tr.id, ctxOffset + n.t, n.pitch, n.vel, dur, override);
      if (duck.has(tr.id)) graph.triggerDuckers(tr.id, ctxOffset + n.t, n.pitch, n.vel);
    }
    // audio clips
    const au = tr.audio;
    if (o.first) {
      for (const a of au) {
        if (a.t < from && a.end > from + 0.005) {
          const skip = from - a.t;
          const end = o.cutAt !== undefined ? Math.min(a.end, o.cutAt) : a.end;
          graph.playAudio(tr.id, ctxOffset + from, a.assetId, a.offsetSec + skip * a.rate, end - from, a.gain, 0.005, a.fadeOut, a.rate, a.reverse);
        }
      }
    }
    for (let i = lowerBound(au, from); i < au.length && au[i].t < to; i++) {
      const a = au[i];
      const end = o.cutAt !== undefined ? Math.min(a.end, o.cutAt) : a.end;
      graph.playAudio(tr.id, ctxOffset + a.t, a.assetId, a.offsetSec, end - a.t, a.gain, a.fadeIn, a.fadeOut, a.rate, a.reverse);
    }
  }
  // automation: piecewise-linear ramps to the value at the end of the window
  for (const l of song.lanes) {
    const startV = laneValueAt(l, from);
    if (o.first) graph.automate(l.owner, l.target, startV, ctxOffset + from, -2);
    // include breakpoints inside the window for accuracy
    for (const p of l.points) if (p.t > from && p.t < to) graph.automate(l.owner, l.target, p.v, ctxOffset + p.t, -1);
    graph.automate(l.owner, l.target, laneValueAt(l, to), ctxOffset + to, -1);
  }
  // metronome
  if (o.metronome?.enabled) {
    const b0 = Math.ceil(song.tempo.secToBeat(from) - 1e-6);
    for (let b = b0; ; b++) {
      const t = song.tempo.beatToSec(b);
      if (t >= to) break;
      if (t < from) continue;
      const { beatInBar } = o.metronome.meterBeatsPerBar(b);
      graph.click(ctxOffset + t, Math.abs(beatInBar) < 1e-6, o.metronome.volume);
    }
  }
}

// ---------------------------------------------------------------------------
/** Timer that keeps ticking in background tabs (worker timers are not throttled as aggressively). */
function createTicker(ms: number, fn: () => void): () => void {
  try {
    if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
      const src = `let id=null;onmessage=e=>{if(e.data==='start'){clearInterval(id);id=setInterval(()=>postMessage(0),${ms});}else{clearInterval(id);}}`;
      const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      const w = new Worker(url);
      w.onmessage = fn;
      w.postMessage('start');
      return () => { w.postMessage('stop'); w.terminate(); URL.revokeObjectURL(url); };
    }
  } catch { /* fall through */ }
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
}

export interface TransportCallbacks {
  onEnd?: () => void;
}

export class Transport {
  playing = false;
  private song: CompiledSong | null = null;
  private cursorSong = 0;
  private cursorCtx = 0;
  private first = true;
  private anchors: { ctx: number; song: number }[] = [];
  private stopTicker: (() => void) | null = null;
  private pausedAt = 0;
  loop = { enabled: false, start: 0, end: 0 }; // seconds
  metronome: WindowOpts['metronome'] = null;
  countInUntil = 0;
  lookahead = 0.15;
  constructor(private ctx: AudioContext, private graph: () => ProjectGraph, private cb: TransportCallbacks = {}) {}

  setSong(song: CompiledSong) { this.song = song; }

  /** Start playback at song time `fromSec`. Optional count-in clicks `countInSec` before. */
  play(fromSec: number, countInSec = 0, countInBeats = 0) {
    if (!this.song) return;
    this.stop(false);
    const start = this.ctx.currentTime + 0.06 + countInSec;
    if (countInSec > 0 && countInBeats > 0) {
      const spb = countInSec / countInBeats;
      for (let i = 0; i < countInBeats; i++) this.graph().click(start - countInSec + i * spb, i % 4 === 0, this.metronome?.volume ?? 0.7);
    }
    this.countInUntil = start;
    this.cursorSong = fromSec;
    this.cursorCtx = start;
    this.anchors = [{ ctx: start, song: fromSec }];
    this.first = true;
    this.playing = true;
    this.tick();
    this.stopTicker = createTicker(25, () => this.tick());
  }

  stop(resetDynamics = true) {
    if (this.stopTicker) { this.stopTicker(); this.stopTicker = null; }
    if (this.playing) {
      this.pausedAt = this.positionSec();
      this.graph().stopAll();
      if (resetDynamics) this.graph().resetDynamics();
    }
    this.playing = false;
  }

  /** Song position (seconds) currently audible. */
  positionSec(): number {
    if (!this.playing) return this.pausedAt;
    const now = this.ctx.currentTime;
    let a = this.anchors[0];
    for (const x of this.anchors) if (x.ctx <= now) a = x; else break;
    return Math.max(0, a.song + (now - a.ctx));
  }

  private tick() {
    if (!this.playing || !this.song) return;
    const song = this.song;
    const horizon = this.ctx.currentTime + this.lookahead;
    let guard = 0;
    while (this.cursorCtx < horizon && guard++ < 64) {
      let segEnd = this.cursorSong + (horizon - this.cursorCtx);
      let wrap = false;
      const L = this.loop;
      const looping = L.enabled && L.end - L.start > 0.05;
      if (looping && this.cursorSong < L.end && segEnd >= L.end) {
        segEnd = L.end;
        wrap = true;
      }
      scheduleWindow(this.graph(), song, this.cursorSong, segEnd, this.cursorCtx - this.cursorSong, {
        first: this.first,
        cutAt: looping && this.cursorSong < L.end ? L.end : undefined,
        metronome: this.metronome,
      });
      this.first = false;
      this.cursorCtx += segEnd - this.cursorSong;
      this.cursorSong = segEnd;
      if (wrap) {
        this.cursorSong = L.start;
        this.anchors.push({ ctx: this.cursorCtx, song: L.start });
        this.first = true;
      }
    }
    // prune old anchors
    const now = this.ctx.currentTime;
    while (this.anchors.length > 2 && this.anchors[1].ctx <= now) this.anchors.shift();
    // auto stop at end (when not looping)
    if (!this.loop.enabled && this.positionSec() > song.endSec + 1.5 && !this.recordingHold) {
      this.stop();
      this.pausedAt = 0;
      this.cb.onEnd?.();
    }
  }
  /** While recording we keep rolling past the end of the arrangement. */
  recordingHold = false;
}
