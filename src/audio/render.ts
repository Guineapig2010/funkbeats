/**
 * Offline rendering (export). Builds a fresh ProjectGraph on an OfflineAudioContext,
 * schedules the compiled song in chunks (using suspend/resume when available so
 * long songs do not allocate every voice up front) and returns the rendered buffer.
 */
import type { Project } from '../model/schema';
import { compileProject } from './compile';
import { ProjectGraph } from './graph';
import type { AssetResolver } from './instruments/synths';
import { scheduleWindow } from './scheduler';
import { ensureWorklets } from './worklets';

export interface RenderOptions {
  sampleRate: 44100 | 48000;
  /** Song range in beats; defaults to the full arrangement. */
  startBeat?: number;
  endBeat?: number;
  /** Extra seconds rendered after the end for reverb/delay tails. */
  tailSec?: number;
  soloTrackIds?: Set<string> | null;
  bypassMaster?: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Injected for tests (node-web-audio-api) – defaults to the browser global. */
  OfflineCtx?: new (opts: { numberOfChannels: number; length: number; sampleRate: number }) => OfflineAudioContext;
  /** Internal: schedule everything up front instead of chunking with suspend(). */
  noSuspend?: boolean;
}

export class RenderAbortedError extends Error { constructor() { super('Render cancelled'); } }

export async function renderProject(project: Project, assets: AssetResolver, opts: RenderOptions): Promise<AudioBuffer> {
  const song = compileProject(project);
  const startSec = song.tempo.beatToSec(opts.startBeat ?? 0);
  const endSec = song.tempo.beatToSec(opts.endBeat ?? song.endBeat);
  const tail = opts.tailSec ?? 2.5;
  const dur = Math.max(0.5, endSec - startSec + tail);
  const sr = opts.sampleRate;
  const Ctor = opts.OfflineCtx ?? (globalThis as any).OfflineAudioContext;
  if (!Ctor) throw new Error('OfflineAudioContext is not available in this environment');
  const ctx: OfflineAudioContext = new Ctor({ numberOfChannels: 2, length: Math.ceil(dur * sr), sampleRate: sr });
  await ensureWorklets(ctx);
  const graph = new ProjectGraph(ctx, assets, { offline: true, soloTrackIds: opts.soloTrackIds ?? null, bypassMaster: opts.bypassMaster });
  graph.sync(project);
  const duck = graph.hasDuckers();
  const offset = -startSec; // ctxTime = songSec - startSec
  const chunk = 2;
  const canSuspend = typeof ctx.suspend === 'function' && !opts.noSuspend;
  let suspendFailed = false;
  let scheduledTo = startSec;
  const scheduleNext = () => {
    const from = scheduledTo;
    const to = Math.min(endSec + 0.001, from + chunk);
    if (to > from) scheduleWindow(graph, song, from, to, offset, { first: from === startSec, duckSources: duck });
    scheduledTo = to;
  };
  if (!canSuspend) {
    while (scheduledTo < endSec) scheduleNext();
  } else {
    scheduleNext();
    // each suspend point schedules the following chunk just in time
    for (let t = chunk; t < endSec - startSec; t += chunk) {
      const at = Math.floor((t - 0.25) * sr / 128) * 128 / sr; // quantum-aligned, slightly before the chunk boundary
      if (at <= 0 || at >= dur) continue;
      let p: Promise<void>;
      try { p = ctx.suspend(at); } catch { suspendFailed = true; continue; }
      p.then(() => {
        if (opts.signal?.aborted) return; // resume and let it finish; the result is discarded
        scheduleNext();
        opts.onProgress?.(Math.min(0.99, at / dur));
      }).catch(() => { suspendFailed = true; }).finally(() => { ctx.resume().catch(() => { /* not suspended */ }); });
    }
  }
  const abortP = new Promise<never>((_, rej) => opts.signal?.addEventListener('abort', () => rej(new RenderAbortedError())));
  const result = await (opts.signal ? Promise.race([ctx.startRendering(), abortP]) : ctx.startRendering());
  graph.dispose();
  if (canSuspend && (suspendFailed || scheduledTo < endSec - 1e-3)) {
    // chunked scheduling failed on this implementation: render again with everything scheduled up front
    return renderProject(project, assets, { ...opts, noSuspend: true });
  }
  opts.onProgress?.(1);
  return result;
}
