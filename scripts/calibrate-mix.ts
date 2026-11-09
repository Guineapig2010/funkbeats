/** Dev tool: renders each track of a generated song solo and prints levels (npx tsx scripts/calibrate-mix.ts "prompt"). */
import * as wa from 'node-web-audio-api';
for (const [k, v] of Object.entries(wa)) if (!(k in globalThis)) (globalThis as any)[k] = v;
import { composeLocal, DEFAULT_SETTINGS } from '../src/compose/composer';
import { renderProject } from '../src/audio/render';
import { analyze } from '../src/export/analysis';
(async () => {
const prompt = process.argv[2] ?? 'edm';
const { project } = composeLocal({ ...DEFAULT_SETTINGS, prompt, seed: 3, durationSec: 40 });
// render the highest-energy section only
const big = project.sections.reduce((a, s) => (s.energy > a.energy ? s : a));
const opts = { sampleRate: 44100 as const, OfflineCtx: (wa as any).OfflineAudioContext, startBeat: big.start, endBeat: big.start + Math.min(big.length, 16), tailSec: 0.5 };
for (const t of project.tracks) {
  const b = await renderProject(project, { get: () => undefined }, { ...opts, soloTrackIds: new Set([t.id]), bypassMaster: true });
  const a = analyze(b);
  console.log(t.name.padEnd(28), t.instrument.preset.padEnd(16), 'vol', String(t.volume).padStart(4), 'peak', a.peakDb.toFixed(1).padStart(6), 'rms', a.rmsDb.toFixed(1).padStart(6));
}
const all = analyze(await renderProject(project, { get: () => undefined }, { ...opts, bypassMaster: true }));
console.log('MIX pre-master peak', all.peakDb.toFixed(1), 'rms', all.rmsDb.toFixed(1), 'lufs', all.lufs.toFixed(1));
const m = analyze(await renderProject(project, { get: () => undefined }, opts));
console.log('MIX mastered peak', m.peakDb.toFixed(1), 'rms', m.rmsDb.toFixed(1), 'lufs', m.lufs.toFixed(1), project.master.preset);

})();
