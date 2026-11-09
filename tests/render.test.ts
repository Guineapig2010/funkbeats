import { describe, expect, it } from 'vitest';
import { newMidiClip, newNote, newProject, newTrack } from '../src/model/factory';
import { renderProject } from '../src/audio/render';
import { OfflineCtx, noAssets, peak, rms } from './helpers';
import { makeEffect } from '../src/model/effects';
import { PRESETS } from '../src/model/presets';

function simpleProject(preset = 'saw-lead') {
  const p = newProject('t');
  p.bpm = 120;
  const t = newTrack({ preset, name: 'Lead' });
  t.clips.push(newMidiClip(0, 4, [newNote(60, 0, 1), newNote(64, 1, 1), newNote(67, 2, 2)]));
  p.tracks.push(t);
  return p;
}

describe('offline rendering', () => {
  it('renders audible audio for a synth track', async () => {
    const p = simpleProject();
    const buf = await renderProject(p, noAssets, { sampleRate: 44100, OfflineCtx, tailSec: 0.5 });
    expect(buf.duration).toBeGreaterThan(2);
    expect(rms(buf)).toBeGreaterThan(0.005);
    expect(peak(buf)).toBeLessThanOrEqual(1.0001);
  });

  it('silence where there are no notes, sound where there are', async () => {
    const p = newProject();
    const t = newTrack({ preset: 'synth-bass' });
    t.clips.push(newMidiClip(4, 4, [newNote(40, 0, 2)])); // beat 4..6 => 2s..3s at 120bpm
    p.tracks.push(t);
    const buf = await renderProject(p, noAssets, { sampleRate: 44100, OfflineCtx, tailSec: 0.5 });
    const sr = 44100;
    expect(rms(buf, 0, sr * 1.8)).toBeLessThan(1e-4);
    expect(rms(buf, Math.floor(sr * 2.1), Math.floor(sr * 2.9))).toBeGreaterThan(0.01);
  });

  it('every preset produces sound', async () => {
    for (const pr of PRESETS) {
      const p = newProject();
      const t = newTrack({ preset: pr.id });
      const pitch = pr.kind === 'drumkit' ? 36 : Math.round((pr.range[0] + pr.range[1]) / 2);
      t.clips.push(newMidiClip(0, 2, [newNote(pitch, 0, 1.5, 0.9), newNote(pr.kind === 'drumkit' ? 38 : pitch + 4, 0.5, 1, 0.9)]));
      p.tracks.push(t);
      const buf = await renderProject(p, noAssets, { sampleRate: 44100, OfflineCtx, tailSec: 0.3 });
      expect(rms(buf), pr.id).toBeGreaterThan(pr.id === 'noise-riser' ? 0.0003 : 0.001);
    }
  });

  it('mute and volume affect the output', async () => {
    const p = simpleProject();
    const loud = rms(await renderProject(p, noAssets, { sampleRate: 44100, OfflineCtx }));
    p.tracks[0].volume = -26;
    const quiet = rms(await renderProject(p, noAssets, { sampleRate: 44100, OfflineCtx }));
    expect(quiet).toBeLessThan(loud * 0.2);
    p.tracks[0].mute = true;
    const muted = rms(await renderProject(p, noAssets, { sampleRate: 44100, OfflineCtx }));
    expect(muted).toBeLessThan(1e-5);
  });

  it('effects alter the audio (distortion adds energy, filter removes highs)', async () => {
    const base = simpleProject();
    const a = await renderProject(base, noAssets, { sampleRate: 44100, OfflineCtx });
    const withDist = simpleProject();
    withDist.tracks[0].effects.push(makeEffect('distortion', { drive: 0.9, output: 0 }));
    const b = await renderProject(withDist, noAssets, { sampleRate: 44100, OfflineCtx });
    expect(Math.abs(rms(b) - rms(a))).toBeGreaterThan(0.002);
    const withLp = simpleProject();
    withLp.tracks[0].effects.push(makeEffect('filter', { cutoff: 80, resonance: 0.7 }));
    const c = await renderProject(withLp, noAssets, { sampleRate: 44100, OfflineCtx });
    expect(rms(c)).toBeLessThan(rms(a) * 0.5);
  });

  it('limiter on master keeps peaks under the ceiling', async () => {
    const p = simpleProject('supersaw');
    p.tracks[0].volume = 12;
    p.tracks[0].instrument.params.gain = 6;
    p.master.effects = [makeEffect('limiter', { gain: 12, ceiling: -1 })];
    const buf = await renderProject(p, noAssets, { sampleRate: 44100, OfflineCtx });
    expect(peak(buf)).toBeLessThan(0.95);
    expect(rms(buf)).toBeGreaterThan(0.05);
  });
});
