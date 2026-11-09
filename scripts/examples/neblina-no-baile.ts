/** Example: an original slowed pluggnb/baile song authored as a CompositionSpec (the format Claude returns). Usage: npx tsx scripts/examples/neblina-no-baile.ts <outDir> */
import * as wa from 'node-web-audio-api';
for (const [k, v] of Object.entries(wa)) if (!(k in globalThis)) (globalThis as any)[k] = v;
import { writeFileSync } from 'node:fs';
import { validateSpec } from '../../src/compose/spec';
import { composeFromSpec, DEFAULT_SETTINGS, describeSpec } from '../../src/compose/composer';
import { renderProject } from '../../src/audio/render';
import { analyze } from '../../src/export/analysis';
import { encodeWav } from '../../src/export/wav';
import { serializeProject } from '../../src/model/factory';
import { makeEffect } from '../../src/model/effects';

const OUT = process.argv[2];
type N = { pitch: string; start: number; duration: number; velocity?: number };
const shift = (ns: N[], by: number) => ns.map((n) => ({ ...n, start: n.start + by }));
const v = (ns: N[], vel: number) => ns.map((n) => ({ ...n, velocity: n.velocity ?? vel }));
// ---- original hook (verse), 4 bars over Bm9 – C#m7 – F#m9 – E ----
const A: N[] = [
  { pitch: 'C#5', start: 0, duration: 0.7 }, { pitch: 'E5', start: 0.75, duration: 0.7 }, { pitch: 'F#5', start: 1.5, duration: 0.95 }, { pitch: 'E5', start: 2.5, duration: 0.45 }, { pitch: 'C#5', start: 3, duration: 0.95 },
  { pitch: 'B4', start: 4.5, duration: 0.45 }, { pitch: 'C#5', start: 5, duration: 0.7 }, { pitch: 'E5', start: 5.75, duration: 0.7 }, { pitch: 'G#5', start: 6.5, duration: 1.4 },
  { pitch: 'A5', start: 8, duration: 0.7 }, { pitch: 'G#5', start: 8.75, duration: 0.7 }, { pitch: 'F#5', start: 9.5, duration: 1.4 }, { pitch: 'C#5', start: 11, duration: 0.45 }, { pitch: 'E5', start: 11.5, duration: 0.45 },
  { pitch: 'F#5', start: 12, duration: 0.7 }, { pitch: 'E5', start: 12.75, duration: 0.7 }, { pitch: 'B4', start: 13.5, duration: 0.95 }, { pitch: 'C#5', start: 14.5, duration: 1.4 },
];
// answer phrase: same opening, resolves home
const A2: N[] = [
  ...A.slice(0, 9),
  { pitch: 'A5', start: 8, duration: 0.7 }, { pitch: 'B5', start: 8.75, duration: 0.7 }, { pitch: 'C#6', start: 9.5, duration: 1.4 }, { pitch: 'B5', start: 11, duration: 0.45 }, { pitch: 'A5', start: 11.5, duration: 0.45 },
  { pitch: 'G#5', start: 12, duration: 0.7 }, { pitch: 'E5', start: 12.75, duration: 0.7 }, { pitch: 'F#5', start: 13.5, duration: 2.4 },
];
// ---- chorus hook, 4 bars over Dmaj7 – E – F#m9 – F#m9 (longer, higher, more open) ----
const B: N[] = [
  { pitch: 'F#5', start: 0, duration: 1.4 }, { pitch: 'E5', start: 1.5, duration: 0.45 }, { pitch: 'F#5', start: 2, duration: 0.45 }, { pitch: 'A5', start: 2.5, duration: 1.4 },
  { pitch: 'G#5', start: 4, duration: 0.7 }, { pitch: 'F#5', start: 4.75, duration: 0.7 }, { pitch: 'E5', start: 5.5, duration: 0.95 }, { pitch: 'B4', start: 6.5, duration: 1.4 },
  { pitch: 'C#5', start: 8, duration: 0.45 }, { pitch: 'E5', start: 8.5, duration: 0.45 }, { pitch: 'F#5', start: 9, duration: 2.4 },
  { pitch: 'E5', start: 12.5, duration: 0.45 }, { pitch: 'C#6', start: 13, duration: 0.95 }, { pitch: 'B5', start: 14, duration: 0.45 }, { pitch: 'A5', start: 14.5, duration: 1.4 },
];
const B2: N[] = [
  ...B.slice(0, 8),
  { pitch: 'C#5', start: 8, duration: 0.45 }, { pitch: 'E5', start: 8.5, duration: 0.45 }, { pitch: 'A5', start: 9, duration: 1.4 }, { pitch: 'G#5', start: 10.5, duration: 0.45 }, { pitch: 'E5', start: 11, duration: 0.95 },
  { pitch: 'F#5', start: 12, duration: 3.9 },
];
const verse = [...v(A, 0.78), ...shift(v(A2, 0.8), 16), ...shift(v(A, 0.82), 32), ...shift(v(A2, 0.85), 48)];
const chorus = [...v(B, 0.85), ...shift(v(B2, 0.85), 16), ...shift(v(B, 0.9), 32), ...shift(v(B2, 0.9), 48)];
const intro = v(A, 0.55);
const outro = [...v(B, 0.7), ...shift(v(B2, 0.6), 16)];

const vChords = ['Bm9', 'C#m7', 'F#m9', 'E'];
const cChords = ['Dmaj7', 'E', 'F#m9', 'F#m9'];
const rep = (c: string[], bars: number) => Array.from({ length: bars }, (_, i) => c[i % c.length]);

const raw = {
  title: 'Neblina no Baile', genre: 'pluggnb', mood: 'dreamy', bpm: 103, key: { tonic: 6, mode: 'minor' }, timeSignature: { numerator: 4, denominator: 4 },
  sections: [
    { name: 'Intro', kind: 'intro', bars: 4, energy: 0.35, chords: rep(vChords, 4), roles: ['pad', 'melody'] },
    { name: 'Verse', kind: 'verse', bars: 16, energy: 0.8, chords: rep(vChords, 16), roles: ['drums', 'bass', 'pad', 'melody'] },
    { name: 'Breakdown', kind: 'breakdown', bars: 4, energy: 0.35, chords: rep(cChords, 4), roles: ['pad', 'arp'] },
    { name: 'Chorus', kind: 'chorus', bars: 16, energy: 0.92, chords: rep(cChords, 16), roles: ['drums', 'bass', 'pad', 'melody', 'arp'] },
    { name: 'Outro', kind: 'outro', bars: 8, energy: 0.5, chords: rep(cChords, 8), roles: ['drums', 'bass', 'pad', 'melody'] },
  ],
  tracks: [
    { name: 'Baile Drums', role: 'drums', preset: 'kit-trap' },
    { name: '808 Slide', role: 'bass', preset: '808-bass', effects: ['808-dirt'] },
    { name: 'Dream Pad', role: 'pad', preset: 'dream-pad', comp: 'pad', effects: ['plugg-wash'] },
    { name: 'Plugg Lead', role: 'melody', preset: 'plugg-lead', effects: ['plugg-wash'] },
    { name: 'Bell Keys', role: 'arp', preset: 'celesta', comp: 'arp', effects: ['plugg-wash'] },
  ],
  drums: 'baile', bass: 'baile-808', swing: 0, melodyDensity: 0.45, syncopation: 0.55, complexity: 0.5, creativity: 0.4, mastering: 'lofi', ritardando: false, seed: 2311,
  parts: [
    { track: 'Plugg Lead', section: 'Intro', notes: intro },
    { track: 'Plugg Lead', section: 'Verse', notes: verse },
    { track: 'Plugg Lead', section: 'Chorus', notes: chorus },
    { track: 'Plugg Lead', section: 'Outro', notes: outro },
  ],
  notes: 'Original song in a slowed pluggnb / baile-funk style: tamborzão-style kick & snap groove, sliding 808s, washed dream pad, soft plugg lead.',
};
const res = validateSpec(raw);
if (!res.ok) { console.error(res.errors); process.exit(1); }
const { project, spec } = composeFromSpec(res.spec, { ...DEFAULT_SETTINGS, prompt: 'slowed pluggnb baile funk, dreamy plugg lead over sliding 808s, F# minor, 103 bpm', genre: 'pluggnb', bpm: 103, durationSec: 115, engine: 'local', seed: 2311 });
// intro: lead heard through a closed filter; outro drums fade
const lead = project.tracks.find((t) => t.name === 'Plugg Lead')!;
lead.automation = [{ id: 'au-lead', target: 'inst.cutoff', enabled: true, points: [{ beat: 0, value: 900 }, { beat: 15.9, value: 1800 }, { beat: 16, value: 2600 }] }];
lead.volume = -3;
const set = (name: string, vol: number) => { project.tracks.find((t) => t.name === name)!.volume = vol; };
set('808 Slide', -11); set('Dream Pad', -6); set('Bell Keys', -9); set('Baile Drums', -3);
// 808: less pure sub, more audible harmonics (like a driven 808), tighter low end
const b = project.tracks.find((t) => t.name === '808 Slide')!;
b.effects = [makeEffect('saturation', { drive: 12, warmth: 0.2, mix: 1 }), makeEffect('eq', { hpf: 36, lowFreq: 60, lowGain: -5, mid1Freq: 140, mid1Gain: 3, mid1Q: 0.8, mid2Freq: 700, mid2Gain: 2 }), makeEffect('compressor', { threshold: -18, ratio: 4, attack: 0.01, release: 0.15, makeup: 2 })];
b.instrument.params.osc2 = { ...b.instrument.params.osc2, level: 0.45 };
const drums = project.tracks.find((t) => t.name === 'Baile Drums')!;
const outroStart = project.sections.find((s) => s.name === 'Outro')!.start;
drums.automation = [{ id: 'au-dr', target: 'volume', enabled: true, points: [{ beat: outroStart, value: drums.volume }, { beat: outroStart + 32, value: -40 }] }];
// slowed/dark master: gentle lowpass before the lofi chain's limiter
project.master.effects.splice(project.master.effects.length - 1, 0, makeEffect('filter', { mode: 'lowpass', cutoff: 11000, resonance: 0.5 }));
project.master.effects = project.master.effects.map((e) => (e.type === 'limiter' ? { ...e, params: { ...e.params, gain: 2 } } : e));
project.returns = project.returns.map((r) => (r.id === 'ret-reverb' ? { ...r, effects: [makeEffect('reverb', { decay: 3.8, predelay: 0.03, size: 0.7, mix: 1, tone: 4500 })] } : r));
console.log(describeSpec(spec).join('\n'));
console.log('tracks:', project.tracks.map((t) => `${t.name}(${t.clips.reduce((a, c) => a + c.notes.length, 0)} notes, ${t.volume}dB)`).join(', '));
writeFileSync(`${OUT}/Neblina_no_Baile.aims.json`, serializeProject(project));
(async () => {
  const t0 = Date.now();
  const buf = await renderProject(project, { get: () => undefined }, { sampleRate: 44100, OfflineCtx: (wa as any).OfflineAudioContext, tailSec: 3 });
  const a = analyze(buf);
  console.log(`rendered ${buf.duration.toFixed(1)}s in ${((Date.now() - t0) / 1000).toFixed(0)}s · peak ${a.peakDb.toFixed(1)} dBFS · ${a.lufs.toFixed(1)} LUFS · clipped ${a.clippedSamples}`);
  writeFileSync(`${OUT}/Neblina_no_Baile.wav`, Buffer.from(encodeWav(buf, 16)));
})();
