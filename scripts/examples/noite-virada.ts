/** Example: an original hard Brazilian trap-funk song (stop → drop architecture) authored as a CompositionSpec.
 *  Usage: npx tsx scripts/examples/noite-virada.ts <outDir> */
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

const OUT = process.argv[2] ?? '.';
type N = { pitch: string; start: number; duration: number; velocity?: number };
const n = (pitch: string, start: number, duration: number): N => ({ pitch, start, duration });
// ---- original hook in D# harmonic minor over | B | A# | D#m | A# | ----
const M = [
  [n('A#4', 0, 0.4), n('B4', 0.5, 0.4), n('D#5', 1, 0.7), n('F#5', 1.75, 0.7), n('F5', 2.5, 0.4), n('D#5', 3, 0.9)],
  [n('D5', 0, 0.7), n('F5', 0.75, 0.7), n('A#5', 1.5, 0.9), n('G#5', 2.5, 0.4), n('F5', 3, 0.9)],
  [n('F#5', 0, 0.4), n('F5', 0.5, 0.4), n('D#5', 1, 1.4), n('A#4', 2.75, 0.4), n('D5', 3.25, 0.7)],
  [n('D#5', 0, 0.4), n('F5', 0.5, 0.4), n('F#5', 1, 0.7), n('F5', 1.75, 0.7), n('D5', 2.5, 1.4)],
];
const M2 = [
  [n('F#5', 0, 0.4), n('G#5', 0.5, 0.4), n('F#5', 1, 0.4), n('D#5', 1.5, 0.7), n('B4', 2.25, 0.7), n('D#5', 3, 0.9)],
  [n('F5', 0, 0.4), n('D5', 0.5, 0.4), n('F5', 1, 0.7), n('A#5', 1.75, 0.7), n('G#5', 2.5, 0.4), n('F5', 3, 0.9)],
  [n('D#5', 0, 0.7), n('F#5', 0.75, 0.7), n('A#5', 1.5, 1.4), n('G#5', 3, 0.4), n('F#5', 3.5, 0.4)],
  [n('F5', 0, 1.4), n('D5', 1.5, 0.7), n('F5', 2.25, 0.4), n('D5', 2.75, 1.2)],
];
const sparse = (bar: N[]) => bar.filter((x) => x.duration >= 0.7);
/** Concatenate bars (arrays of notes, beats within the bar) into one part with velocity. */
const bars = (list: N[][], vel: number) => list.flatMap((b, i) => b.map((x) => ({ ...x, start: x.start + i * 4, velocity: vel })));
const ending = [[n('F#5', 0, 0.7), n('F5', 0.75, 0.7), n('D#5', 1.5, 2.4)]];

const loop = ['B', 'A#', 'D#m', 'A#'];
let g = 0; // global bar index keeps the 4-bar loop continuous across short sections
const chords = (count: number) => Array.from({ length: count }, () => loop[(g++ + 3) % 4]);
const sec = (name: string, kind: string, count: number, energy: number, roles: string[]) => ({ name, kind, bars: count, energy, chords: chords(count), roles });

const raw = {
  title: 'Noite Virada', genre: 'brfunk', mood: 'dark', bpm: 136, key: { tonic: 3, mode: 'harmonicMinor' }, timeSignature: { numerator: 4, denominator: 4 },
  sections: [
    sec('Pickup', 'intro', 1, 0.4, ['melody', 'pad']),
    sec('Pre', 'prechorus', 4, 0.6, ['melody', 'pad', 'drums']),
    sec('Pre 808', 'prechorus', 3, 0.7, ['melody', 'pad', 'drums', 'bass']),
    sec('Stop', 'buildup', 1, 0.6, ['melody', 'fx']),
    sec('Drop', 'drop', 8, 1, ['melody', 'pad', 'drums', 'bass', 'arp']),
    sec('Switch', 'verse', 4, 0.6, ['melody', 'pad', 'drums']),
    sec('Switch 808', 'verse', 3, 0.75, ['melody', 'pad', 'drums', 'bass']),
    sec('Stop 2', 'buildup', 1, 0.6, ['melody', 'fx']),
    sec('Final Drop', 'drop', 8, 1, ['melody', 'pad', 'drums', 'bass', 'arp']),
    sec('Outro', 'outro', 8, 0.35, ['melody', 'pad']),
  ],
  tracks: [
    { name: 'Funk Drums', role: 'drums', preset: 'kit-trap', volume: -3 },
    { name: '808 Funk', role: 'bass', preset: '808-bass', effects: ['808-hard'], volume: -7 },
    { name: 'Dark Lead', role: 'melody', preset: 'square-lead', effects: ['lead-bite'], volume: -5 },
    { name: 'Bells', role: 'arp', preset: 'bells', comp: 'arp', volume: -14 },
    { name: 'Shadow Pad', role: 'pad', preset: 'dark-pad', comp: 'pad', volume: -10 },
    { name: 'FX Riser', role: 'fx', preset: 'noise-riser', volume: -8 },
  ],
  drums: 'funkbr', bass: 'funk-808', swing: 0, melodyDensity: 0.6, syncopation: 0.6, complexity: 0.5, creativity: 0.4, mastering: 'electronic', ritardando: false, seed: 1364,
  parts: [
    { track: 'Dark Lead', section: 'Pickup', notes: bars([M2[3]], 0.7) },
    { track: 'Dark Lead', section: 'Pre', notes: bars(M.map(sparse), 0.72) },
    { track: 'Dark Lead', section: 'Pre 808', notes: bars(M2.slice(0, 3), 0.8) },
    { track: 'Dark Lead', section: 'Stop', notes: bars([M[3]], 0.85) },
    { track: 'Dark Lead', section: 'Drop', notes: bars([...M, ...M2], 0.92) },
    { track: 'Dark Lead', section: 'Switch', notes: bars(M.map(sparse), 0.72) },
    { track: 'Dark Lead', section: 'Switch 808', notes: bars(M2.slice(0, 3), 0.8) },
    { track: 'Dark Lead', section: 'Stop 2', notes: bars([M[3]], 0.85) },
    { track: 'Dark Lead', section: 'Final Drop', notes: bars([...M2, ...M], 0.95) },
    { track: 'Dark Lead', section: 'Outro', notes: bars([...M.map(sparse), ...M2.slice(0, 3).map(sparse), ...ending], 0.65) },
  ],
  notes: 'Original hard Brazilian trap-funk: one-bar stops before each drop, punchy 808 on the kick grid, harmonic-minor lead.',
};
const res = validateSpec(raw);
if (!res.ok) { console.error(res.errors); process.exit(1); }
const { project, spec } = composeFromSpec(res.spec, { ...DEFAULT_SETTINGS, prompt: 'hard brazilian trap funk, dark harmonic minor lead, stops before the drops, 136 bpm', genre: 'brfunk', bpm: 136, durationSec: 72, seed: 1364 });
// fade the outro pad/lead and make the lead brighter in the drops
const outro = project.sections.find((s) => s.name === 'Outro')!;
for (const t of project.tracks.filter((x) => ['Dark Lead', 'Shadow Pad'].includes(x.name))) t.automation = [...t.automation.filter((a) => a.target !== 'volume'), { id: `fade-${t.id}`, target: 'volume', enabled: true, points: [{ beat: outro.start, value: t.volume }, { beat: outro.start + outro.length, value: t.volume - 30 }] }];
// reference-matched mix: lighter sub, brighter percussion & lead, louder master
const T = (name: string) => project.tracks.find((t) => t.name === name)!;
const drums = T('Funk Drums');
// in the Pre/Switch bars the low end drops out: keep percussion, remove the kick
for (const sName of ['Pre', 'Switch']) {
  const s = project.sections.find((x) => x.name === sName)!;
  drums.clips = drums.clips.map((c) => (c.sectionId === s.id ? { ...c, notes: c.notes.filter((x) => x.pitch !== 36) } : c));
}
for (const [pitch, level] of [['42', 1.7], ['46', 1.4], ['40', 1.5], ['39', 1.3], ['37', 1.3], ['54', 1.4]] as const) drums.instrument.pieces[pitch] = { ...drums.instrument.pieces[pitch], level };
drums.volume = -1;
const bass = T('808 Funk');
bass.volume = -10;
bass.effects = bass.effects.map((e) => (e.type === 'eq' ? { ...e, params: { ...e.params, hpf: 38, lowGain: -6, mid1Gain: 5, mid2Gain: 5 } } : e.type === 'distortion' ? { ...e, params: { ...e.params, drive: 0.6, mix: 0.85 } } : e));
const lead = T('Dark Lead');
lead.volume = 0;
lead.instrument.params.filter = { ...lead.instrument.params.filter, cutoff: 5200 };
T('Bells').volume = -7;
T('Shadow Pad').volume = -7;
T('Shadow Pad').volume = -11;
lead.effects = lead.effects.map((e) => (e.type === 'eq' ? { ...e, params: { ...e.params, mid1Freq: 450, mid1Gain: -4, mid2Freq: 2600, mid2Gain: 5, highGain: 3 } } : e));
// loud funk master: glue compression, saturation as soft clipper, brick-wall limiter with true-peak headroom
project.master.effects = [
  makeEffect('eq', { hpf: 34, lowFreq: 70, lowGain: -3.5, mid1Freq: 400, mid1Gain: -2.5, mid2Freq: 3000, mid2Gain: 2.5, highFreq: 10000, highGain: 3 }),
  makeEffect('compressor', { threshold: -14, ratio: 3, attack: 0.01, release: 0.1, knee: 6, makeup: 2 }),
  makeEffect('saturation', { drive: 7, warmth: 0.2, mix: 0.6 }),
  makeEffect('width', { width: 1.1, monoBelow: 140 }),
  makeEffect('limiter', { gain: 8.5, ceiling: -2, release: 0.05 }),
];
console.log(describeSpec(spec).join('\n'));
console.log('tracks:', project.tracks.map((t) => `${t.name}(${t.clips.reduce((a, c) => a + c.notes.length, 0)})`).join(', '));
writeFileSync(`${OUT}/Noite_Virada.aims.json`, serializeProject(project));
(async () => {
  const t0 = Date.now();
  const buf = await renderProject(project, { get: () => undefined }, { sampleRate: 44100, OfflineCtx: (wa as any).OfflineAudioContext, tailSec: 2 });
  const a = analyze(buf);
  console.log(`rendered ${buf.duration.toFixed(1)}s in ${((Date.now() - t0) / 1000).toFixed(0)}s · peak ${a.peakDb.toFixed(1)} dBFS · ${a.lufs.toFixed(1)} LUFS · clipped ${a.clippedSamples}`);
  writeFileSync(`${OUT}/Noite_Virada.wav`, Buffer.from(encodeWav(buf, 16)));
})();
