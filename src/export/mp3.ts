/** MP3 encoding via lamejs (LGPL, pure JS LAME port). Loaded lazily to keep the main bundle small. */
import type { PcmLike } from './wav';

export async function encodeMp3(buf: PcmLike, kbps = 192, onProgress?: (f: number) => void): Promise<Blob> {
  const lame: any = await import('@breezystack/lamejs');
  const Mp3Encoder = lame.Mp3Encoder ?? lame.default?.Mp3Encoder;
  const channels = Math.min(2, buf.numberOfChannels);
  const sr = buf.sampleRate;
  if (![32000, 44100, 48000].includes(sr)) throw new Error(`MP3 encoder supports 32/44.1/48 kHz, got ${sr}`);
  const enc = new Mp3Encoder(channels, sr, kbps);
  const toInt16 = (f: Float32Array) => {
    const o = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)));
    return o;
  };
  const L = toInt16(buf.getChannelData(0));
  const R = channels > 1 ? toInt16(buf.getChannelData(1)) : L;
  const chunks: Uint8Array[] = [];
  const block = 1152 * 20;
  for (let i = 0; i < L.length; i += block) {
    const out = channels > 1 ? enc.encodeBuffer(L.subarray(i, i + block), R.subarray(i, i + block)) : enc.encodeBuffer(L.subarray(i, i + block));
    if (out.length) chunks.push(new Uint8Array(out));
    if (onProgress && (i / block) % 20 === 0) { onProgress(i / L.length); await new Promise((r) => setTimeout(r, 0)); }
  }
  const end = enc.flush();
  if (end.length) chunks.push(new Uint8Array(end));
  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
}
