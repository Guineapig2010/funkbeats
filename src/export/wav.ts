/** WAV (RIFF) encoder: 16/24-bit PCM (TPDF-dithered) and 32-bit float. */
export type BitDepth = 16 | 24 | 32;

export interface PcmLike { numberOfChannels: number; length: number; sampleRate: number; getChannelData(ch: number): Float32Array }

export function encodeWav(buf: PcmLike, bitDepth: BitDepth = 16, dither = true): ArrayBuffer {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const bytes = bitDepth / 8;
  const dataSize = len * ch * bytes;
  const ab = new ArrayBuffer(44 + dataSize);
  const v = new DataView(ab);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, bitDepth === 32 ? 3 : 1, true); // 3 = IEEE float
  v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * bytes, true);
  v.setUint16(32, ch * bytes, true);
  v.setUint16(34, bitDepth, true);
  w(36, 'data'); v.setUint32(40, dataSize, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  let seed = 22222;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  if (bitDepth === 32) {
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { v.setFloat32(o, chans[c][i], true); o += 4; }
  } else if (bitDepth === 16) {
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
      let s = chans[c][i] * 32767 + (dither ? rand() - rand() : 0);
      s = Math.max(-32768, Math.min(32767, Math.round(s)));
      v.setInt16(o, s, true); o += 2;
    }
  } else {
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
      let s = chans[c][i] * 8388607 + (dither ? rand() - rand() : 0);
      s = Math.max(-8388608, Math.min(8388607, Math.round(s)));
      v.setUint8(o, s & 0xff); v.setUint8(o + 1, (s >> 8) & 0xff); v.setUint8(o + 2, (s >> 16) & 0xff); o += 3;
    }
  }
  return ab;
}

/** Minimal WAV decoder (PCM 16/24/32 int and 32 float) used by tests and as a fallback. */
export function decodeWav(ab: ArrayBuffer): { sampleRate: number; channels: Float32Array[] } {
  const v = new DataView(ab);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let o = 12, fmt = 1, ch = 2, sr = 44100, bits = 16;
  let dataOff = -1, dataLen = 0;
  while (o + 8 <= ab.byteLength) {
    const id = tag(o), size = v.getUint32(o + 4, true);
    if (id === 'fmt ') { fmt = v.getUint16(o + 8, true); ch = v.getUint16(o + 10, true); sr = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true); }
    if (id === 'data') { dataOff = o + 8; dataLen = Math.min(size, ab.byteLength - dataOff); break; }
    o += 8 + size + (size % 2);
  }
  if (dataOff < 0) throw new Error('WAV has no data chunk');
  const bps = bits / 8;
  const frames = Math.floor(dataLen / (bps * ch));
  const out = Array.from({ length: ch }, () => new Float32Array(frames));
  let p = dataOff;
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) {
    let s = 0;
    if (fmt === 3 && bits === 32) s = v.getFloat32(p, true);
    else if (bits === 16) s = v.getInt16(p, true) / 32768;
    else if (bits === 24) { let x = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16); if (x & 0x800000) x |= ~0xffffff; s = x / 8388608; }
    else if (bits === 32) s = v.getInt32(p, true) / 2147483648;
    else if (bits === 8) s = (v.getUint8(p) - 128) / 128;
    out[c][i] = s; p += bps;
  }
  return { sampleRate: sr, channels: out };
}
