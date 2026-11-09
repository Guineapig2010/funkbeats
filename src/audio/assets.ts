/**
 * Decoded audio asset cache. Raw file bytes live in IndexedDB; decoded AudioBuffers
 * are cached here and shared between live playback and offline renders.
 */
import { getAsset, putAsset, type StoredAsset } from '../storage/db';
import { uid } from '../util/id';

export class AssetManager {
  private buffers = new Map<string, AudioBuffer>();
  private reversed = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  readonly names = new Map<string, string>();
  readonly missing = new Set<string>();
  listeners = new Set<() => void>();
  constructor(private decodeCtx: () => BaseAudioContext) {}

  get(id: string) { return this.buffers.get(id); }
  getReversed(id: string) {
    let r = this.reversed.get(id);
    if (r) return r;
    const b = this.buffers.get(id);
    if (!b) return undefined;
    r = this.decodeCtx().createBuffer(b.numberOfChannels, b.length, b.sampleRate);
    for (let c = 0; c < b.numberOfChannels; c++) {
      const s = b.getChannelData(c), d = r.getChannelData(c);
      for (let i = 0, n = s.length; i < n; i++) d[i] = s[n - 1 - i];
    }
    this.reversed.set(id, r);
    return r;
  }
  has(id: string) { return this.buffers.has(id); }
  set(id: string, buf: AudioBuffer, name?: string) {
    this.buffers.set(id, buf);
    this.reversed.delete(id);
    this.missing.delete(id);
    if (name) this.names.set(id, name);
    this.listeners.forEach((l) => l());
  }

  /** Decode file bytes. Throws a readable error for unsupported formats. */
  async decode(bytes: ArrayBuffer, name: string): Promise<AudioBuffer> {
    try {
      return await this.decodeCtx().decodeAudioData(bytes.slice(0));
    } catch {
      throw new Error(`"${name}" could not be decoded. This browser supports WAV and usually MP3/OGG/AAC/FLAC/WebM — try converting the file to WAV.`);
    }
  }

  /** Import a file: decode (validates support), persist bytes, cache buffer. */
  async importFile(file: File | Blob, name: string, kind: StoredAsset['kind'] = 'import'): Promise<{ id: string; buffer: AudioBuffer }> {
    const bytes = await file.arrayBuffer();
    const buffer = await this.decode(bytes, name);
    const id = uid('a');
    await putAsset({ id, name, mime: file.type || 'application/octet-stream', size: bytes.byteLength, bytes, createdAt: Date.now(), durationSec: buffer.duration, kind });
    this.set(id, buffer, name);
    return { id, buffer };
  }

  /** Ensure the given assets are decoded (loads from IndexedDB). */
  async ensure(ids: Iterable<string>): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    for (const id of ids) {
      if (this.buffers.has(id)) continue;
      let p = this.loading.get(id);
      if (!p) {
        p = (async () => {
          try {
            const a = await getAsset(id);
            if (!a) { this.missing.add(id); return null; }
            const buf = await this.decode(a.bytes, a.name);
            this.set(id, buf, a.name);
            return buf;
          } catch (e) {
            console.warn('[AIMS] asset load failed', id, e);
            this.missing.add(id);
            return null;
          } finally { this.loading.delete(id); }
        })();
        this.loading.set(id, p);
      }
      jobs.push(p);
    }
    await Promise.all(jobs);
  }
}

export function projectAssetIds(p: { tracks: { clips: { audio: { assetId: string } | null }[]; instrument: { zones: { assetId: string }[]; pieces: Record<string, { sampleAssetId: string | null }> } }[] }): Set<string> {
  const s = new Set<string>();
  for (const t of p.tracks) {
    for (const c of t.clips) if (c.audio) s.add(c.audio.assetId);
    for (const z of t.instrument.zones) s.add(z.assetId);
    for (const pc of Object.values(t.instrument.pieces)) if (pc.sampleAssetId) s.add(pc.sampleAssetId);
  }
  return s;
}
