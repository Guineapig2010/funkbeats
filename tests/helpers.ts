import { OfflineAudioContext as NodeOffline, AudioContext as NodeCtx } from 'node-web-audio-api';
import type { AssetResolver } from '../src/audio/instruments/synths';

export const OfflineCtx = NodeOffline as any;
export const noAssets: AssetResolver = { get: () => undefined };

export function rms(buf: { getChannelData(c: number): Float32Array; numberOfChannels: number }, from = 0, to?: number) {
  let s = 0, n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    const end = to ?? d.length;
    for (let i = from; i < end; i++) { s += d[i] * d[i]; n++; }
  }
  return Math.sqrt(s / Math.max(1, n));
}
export function peak(buf: { getChannelData(c: number): Float32Array; numberOfChannels: number }) {
  let p = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) p = Math.max(p, Math.abs(v));
  return p;
}
export { NodeCtx };
