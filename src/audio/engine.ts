/**
 * StudioEngine: the single live-audio façade used by the UI.
 * Owns the AudioContext, the ProjectGraph, the Transport, asset decoding,
 * keyboard previews and microphone recording.
 */
import type { Instrument, Project } from '../model/schema';
import { MeterMap, TempoMap } from '../model/tempo';
import { encodeWav } from '../export/wav';
import { putAsset } from '../storage/db';
import { uid } from '../util/id';
import { AssetManager } from './assets';
import { compileProject } from './compile';
import { ProjectGraph } from './graph';
import { createInstrument, type InstrumentEngine, type Voice } from './instruments/synths';
import { Transport } from './scheduler';
import { ensureWorklets, workletsReady } from './worklets';

export interface RecordingResult { assetId: string; startBeat: number; durationSec: number; name: string; buffer: AudioBuffer }

export class StudioEngine {
  ctx: AudioContext | null = null;
  graph: ProjectGraph | null = null;
  transport: Transport | null = null;
  readonly assets: AssetManager;
  private project: Project | null = null;
  private tempo = new TempoMap(120);
  private meter = new MeterMap({ numerator: 4, denominator: 4 });
  private compileTimer: ReturnType<typeof setTimeout> | null = null;
  private auditionEngine: InstrumentEngine | null = null;
  private auditionKey = '';
  onStateChange = new Set<() => void>();
  onEnded: (() => void) | null = null;
  lastError: string | null = null;

  // recording
  private mic: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private recNode: AudioWorkletNode | null = null;
  private recChunks: { startFrame: number; data: Float32Array[] }[] = [];
  private recSongStartCtx = 0;
  private recFromSec = 0;
  private recTrackId: string | null = null;
  private monitorGain: GainNode | null = null;
  recording = false;

  constructor() {
    this.assets = new AssetManager(() => this.ensureCtxSync());
  }

  get ready() { return !!this.ctx; }
  get sampleRate() { return this.ctx?.sampleRate ?? 48000; }

  private ensureCtxSync(): AudioContext {
    if (!this.ctx) {
      let ctx: AudioContext;
      try {
        ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: this.project?.sampleRate ?? 48000 });
      } catch {
        ctx = new AudioContext({ latencyHint: 'interactive' });
      }
      this.ctx = ctx;
    }
    return this.ctx;
  }

  /** Must be called from a user gesture at least once (browser autoplay policy). */
  async start(): Promise<void> {
    const ctx = this.ensureCtxSync();
    if (ctx.state !== 'running') await ctx.resume();
    if (!this.graph) {
      await ensureWorklets(ctx);
      this.graph = new ProjectGraph(ctx, this.assets, { metered: true });
      this.transport = new Transport(ctx, () => this.graph!, { onEnd: () => { this.onEnded?.(); this.emit(); } });
      if (this.project) this.applyProject(this.project, true);
    }
    this.emit();
  }

  /** Recreate the context at a new sample rate (44.1 / 48 kHz). */
  async setSampleRate(sr: 44100 | 48000) {
    if (this.ctx?.sampleRate === sr) return;
    this.transport?.stop();
    this.graph?.dispose();
    await this.ctx?.close();
    this.ctx = null;
    this.graph = null;
    this.transport = null;
    this.auditionEngine = null;
    try { this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: sr }); } catch { this.ctx = new AudioContext(); }
    await this.start();
  }

  private emit() { this.onStateChange.forEach((f) => f()); }

  setProject(p: Project) {
    this.project = p;
    this.tempo = TempoMap.fromProject(p);
    this.meter = MeterMap.fromProject(p);
    if (!this.graph) return;
    this.applyProject(p, false);
  }

  private applyProject(p: Project, immediate: boolean) {
    this.graph!.sync(p);
    const t = this.transport!;
    t.loop = p.loop.enabled
      ? { enabled: true, start: this.tempo.beatToSec(p.loop.start), end: this.tempo.beatToSec(p.loop.end) }
      : { enabled: false, start: 0, end: 0 };
    t.metronome = { enabled: p.metronome.enabled, volume: p.metronome.volume, meterBeatsPerBar: (b) => this.meter.beatToBar(b) };
    const doCompile = () => { t.setSong(compileProject(p)); };
    if (immediate || !t.playing) doCompile();
    else {
      if (this.compileTimer) clearTimeout(this.compileTimer);
      this.compileTimer = setTimeout(doCompile, 40);
    }
  }

  // ---------------- transport ----------------
  get playing() { return !!this.transport?.playing; }

  async play(fromBeat: number) {
    await this.start();
    if (!this.project) return;
    await this.assets.ensure(this.projectAssets());
    this.applyProject(this.project, true);
    this.transport!.play(this.tempo.beatToSec(fromBeat));
    this.emit();
  }
  stop() {
    this.transport?.stop();
    this.emit();
  }
  positionBeat(): number {
    if (!this.transport) return 0;
    return this.tempo.secToBeat(this.transport.positionSec());
  }
  positionSec(): number { return this.transport?.positionSec() ?? 0; }
  tempoMap() { return this.tempo; }

  private projectAssets(): string[] {
    const s = new Set<string>();
    for (const t of this.project?.tracks ?? []) {
      for (const c of t.clips) if (c.audio) s.add(c.audio.assetId);
      for (const z of t.instrument.zones) s.add(z.assetId);
      for (const pc of Object.values(t.instrument.pieces)) if (pc.sampleAssetId) s.add(pc.sampleAssetId);
    }
    return [...s];
  }

  // ---------------- previews ----------------
  /** Play a note on a track's instrument immediately (virtual keyboard, note drawing). */
  previewNoteOn(trackId: string, pitch: number, velocity = 0.8): Voice | null {
    if (!this.ctx || !this.graph) { void this.start(); return null; }
    const e = this.graph.engineFor(trackId);
    return e ? e.noteOn(this.ctx.currentTime + 0.005, pitch, velocity) : null;
  }
  previewNoteOff(v: Voice | null) {
    if (v && this.ctx) v.release(this.ctx.currentTime + 0.005);
  }
  previewNote(trackId: string, pitch: number, velocity = 0.8, dur = 0.3) {
    const v = this.previewNoteOn(trackId, pitch, velocity);
    if (v && this.ctx) v.release(this.ctx.currentTime + dur);
  }
  /** Audition an instrument spec without a track (preset browser). */
  async audition(spec: Instrument, pitch = 60, dur = 0.6) {
    await this.start();
    const ctx = this.ctx!;
    const key = JSON.stringify(spec);
    if (!this.auditionEngine || key !== this.auditionKey) {
      this.auditionEngine?.dispose();
      this.auditionEngine = createInstrument(ctx, spec, this.assets);
      this.auditionEngine.output.connect(this.graph!.masterIn);
      this.auditionKey = key;
    }
    this.auditionEngine.playNote(ctx.currentTime + 0.01, pitch, 0.85, dur);
  }

  // ---------------- recording ----------------
  async enableInput(): Promise<MediaStream> {
    await this.start();
    if (this.mic) return this.mic;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone input is not supported in this browser (requires HTTPS or localhost).');
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackConstraints });
    } catch (e) {
      throw new Error(`Microphone permission denied or unavailable: ${(e as Error).message}`);
    }
    this.micSource = this.ctx!.createMediaStreamSource(this.mic);
    return this.mic;
  }
  inputLevelAnalyser(): AnalyserNode | null {
    if (!this.micSource || !this.ctx) return null;
    const a = this.ctx.createAnalyser();
    a.fftSize = 1024;
    this.micSource.connect(a);
    return a;
  }
  /** Route mic into a track (through its effects) for monitoring. */
  setMonitoring(trackId: string | null) {
    if (this.monitorGain) { try { this.monitorGain.disconnect(); } catch { /* noop */ } this.monitorGain = null; }
    if (!trackId || !this.micSource || !this.graph) return;
    const strip = this.graph.stripFor(trackId);
    if (!strip) return;
    this.monitorGain = this.ctx!.createGain();
    this.micSource.connect(this.monitorGain).connect(strip.input);
  }

  async startRecording(trackId: string, fromBeat: number, countInBars: number) {
    if (!this.project) throw new Error('No project');
    await this.enableInput();
    const ctx = this.ctx!;
    if (!workletsReady(ctx)) throw new Error('Recording requires AudioWorklet support, which this browser does not provide.');
    await this.assets.ensure(this.projectAssets());
    this.applyProject(this.project, true);
    this.recChunks = [];
    this.recTrackId = trackId;
    if (!this.recNode) {
      this.recNode = new AudioWorkletNode(ctx, 'aims-recorder', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
      const sink = ctx.createGain();
      sink.gain.value = 0;
      this.micSource!.connect(this.recNode).connect(sink).connect(ctx.destination);
    }
    this.recNode.port.onmessage = (e) => { if (e.data?.data) this.recChunks.push(e.data); };
    const beatsPerBar = this.meter.segAt(fromBeat).beatsPerBar;
    const countBeats = countInBars * beatsPerBar;
    const countInSec = countBeats * 60 / this.tempo.bpmAt(fromBeat);
    this.recFromSec = this.tempo.beatToSec(fromBeat);
    this.recNode.port.postMessage('start');
    this.transport!.recordingHold = true;
    this.transport!.play(this.recFromSec, countInSec, countBeats);
    this.recSongStartCtx = this.transport!.countInUntil;
    this.recording = true;
    this.emit();
  }

  async stopRecording(): Promise<RecordingResult | null> {
    if (!this.recording || !this.recNode || !this.ctx) return null;
    this.recording = false;
    this.transport!.recordingHold = false;
    const done = new Promise<void>((res) => {
      const prev = this.recNode!.port.onmessage;
      this.recNode!.port.onmessage = (e) => { prev?.call(this.recNode!.port, e); if (e.data?.done) res(); };
    });
    this.recNode.port.postMessage('stop');
    await Promise.race([done, new Promise((r) => setTimeout(r, 1000))]);
    this.transport!.stop();
    this.emit();
    const sr = this.ctx.sampleRate;
    if (!this.recChunks.length) return null;
    // stitch chunks in frame order
    this.recChunks.sort((a, b) => a.startFrame - b.startFrame);
    const first = this.recChunks[0].startFrame;
    const last = this.recChunks[this.recChunks.length - 1];
    const total = last.startFrame + last.data[0].length - first;
    const chs = Math.max(1, Math.min(2, this.recChunks[0].data.length));
    const pcm = Array.from({ length: chs }, () => new Float32Array(total));
    for (const c of this.recChunks) for (let ch = 0; ch < chs; ch++) pcm[ch].set(c.data[Math.min(ch, c.data.length - 1)], c.startFrame - first);
    // align: discard count-in and compensate output+input latency (estimate)
    const latency = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    const songStartFrame = Math.round((this.recSongStartCtx + latency) * sr);
    const trim = Math.max(0, songStartFrame - first);
    const len = total - trim;
    if (len < sr * 0.1) return null;
    const buffer = this.ctx.createBuffer(chs, len, sr);
    for (let ch = 0; ch < chs; ch++) buffer.copyToChannel(pcm[ch].subarray(trim), ch);
    const startSec = this.recFromSec + Math.max(0, (first - songStartFrame) / sr);
    const name = `Recording ${new Date().toLocaleTimeString()}`;
    const bytes = encodeWav(buffer, 24, false);
    const id = uid('a');
    await putAsset({ id, name, mime: 'audio/wav', size: bytes.byteLength, bytes, createdAt: Date.now(), durationSec: buffer.duration, kind: 'recording' });
    this.assets.set(id, buffer, name);
    return { assetId: id, startBeat: this.tempo.secToBeat(startSec), durationSec: buffer.duration, name, buffer };
  }

  // ---------------- metering ----------------
  readMaster() { return this.graph?.masterMeter?.read() ?? [0, 0, 0, 0]; }
  readTrack(trackId: string) { return this.graph?.stripFor(trackId)?.meter?.read() ?? [0, 0, 0, 0]; }
  readReturn(id: string) { return this.graph?.returnStrip(id)?.meter?.read() ?? [0, 0, 0, 0]; }
  analyser() { return this.graph?.analyser ?? null; }
  correlation() { return this.graph?.masterMeter?.correlation() ?? 1; }
  limiterReduction() { return this.graph?.masterLimiterReduction() ?? 0; }
  cpuInfo() { return { voices: this.graph?.activeVoices() ?? 0, state: this.ctx?.state ?? 'closed', sampleRate: this.ctx?.sampleRate ?? 0, latency: ((this.ctx?.baseLatency ?? 0) + (this.ctx?.outputLatency ?? 0)) * 1000 }; }
}

export const engine = new StudioEngine();
