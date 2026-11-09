import { describe, expect, it } from 'vitest';
import { composeLocal, DEFAULT_SETTINGS } from '../src/compose/composer';
import { midiToProject, parseMidi, projectToMidi } from '../src/midi/midi';
import { expandClipNotes } from '../src/model/clipOps';
import { decodeWav, encodeWav } from '../src/export/wav';
import { analyze } from '../src/export/analysis';

describe('MIDI', () => {
  it('export → import preserves notes, tempo and meter', () => {
    const { project } = composeLocal({ ...DEFAULT_SETTINGS, prompt: 'pop song', seed: 4, durationSec: 40 });
    const bytes = projectToMidi(project);
    const m = parseMidi(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(m.tempos[0].bpm).toBeCloseTo(project.bpm, 1);
    expect(m.timeSig).toEqual({ numerator: 4, denominator: 4 });
    const back = midiToProject(m, 'x');
    const count = (p: typeof project) => p.tracks.reduce((a, t) => a + t.clips.reduce((b, c) => b + expandClipNotes(c).length, 0), 0);
    expect(count(back)).toBe(count(project));
    expect(back.tracks.some((t) => t.type === 'drums')).toBe(true);
  });
  it('rejects non-MIDI data', () => {
    expect(() => parseMidi(new TextEncoder().encode('RIFF....').buffer as ArrayBuffer)).toThrow(/MIDI/);
  });
});

describe('WAV', () => {
  const sine = (sr: number, len: number) => {
    const L = new Float32Array(len), R = new Float32Array(len);
    for (let i = 0; i < len; i++) { L[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr); R[i] = -L[i]; }
    return { numberOfChannels: 2, length: len, sampleRate: sr, getChannelData: (c: number) => (c ? R : L) };
  };
  for (const bits of [16, 24, 32] as const) {
    it(`${bits}-bit round trip`, () => {
      const src = sine(48000, 4800);
      const dec = decodeWav(encodeWav(src, bits));
      expect(dec.sampleRate).toBe(48000);
      expect(dec.channels.length).toBe(2);
      let err = 0;
      for (let i = 0; i < 4800; i++) err = Math.max(err, Math.abs(dec.channels[0][i] - src.getChannelData(0)[i]));
      expect(err).toBeLessThan(bits === 16 ? 1e-3 : 1e-5);
    });
  }
  it('analysis reports peak and loudness', () => {
    const a = analyze(sine(48000, 48000 * 2));
    expect(a.peakDb).toBeCloseTo(-6.02, 1);
    expect(a.lufs).toBeGreaterThan(-12);
    expect(a.lufs).toBeLessThan(-3);
  });
});
