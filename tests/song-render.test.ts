import { describe, expect, it } from 'vitest';
import { composeLocal, DEFAULT_SETTINGS } from '../src/compose/composer';
import { renderProject } from '../src/audio/render';
import { analyze } from '../src/export/analysis';
import { encodeWav } from '../src/export/wav';
import { TempoMap } from '../src/model/tempo';
import { OfflineCtx, noAssets, rms } from './helpers';
import { writeFileSync } from 'node:fs';

const OUT = process.env.AIMS_RENDER_DIR;

describe.skipIf(!process.env.AIMS_SLOW)('generated songs render to real audio (slow: AIMS_SLOW=1)', () => {
  const prompts: [string, string][] = [
    ['orchestral', 'Create a two-minute heroic orchestral soundtrack with emotional strings, bold brass, cinematic percussion, and a massive final climax.'],
    ['edm', 'Create an energetic electronic dance track with powerful bass, detailed percussion, and a catchy melody.'],
    ['piano', 'Create peaceful piano music with rain ambience and soft strings.'],
  ];
  for (const [name, prompt] of prompts) {
    it(name, async () => {
      const { project } = composeLocal({ ...DEFAULT_SETTINGS, prompt, seed: 3, durationSec: Number(process.env.AIMS_RENDER_SEC ?? 40) });
      const t0 = Date.now();
      const buf = await renderProject(project, noAssets, { sampleRate: 44100, OfflineCtx });
      const ms = Date.now() - t0;
      const a = analyze(buf);
      const tm = TempoMap.fromProject(project);
      const per = project.sections.map((s) => {
        const a0 = Math.floor(tm.beatToSec(s.start) * 44100), a1 = Math.floor(tm.beatToSec(s.start + s.length) * 44100);
        return `${s.name}:${(20 * Math.log10(rms(buf, a0, a1) + 1e-9)).toFixed(1)}dB(e${s.energy.toFixed(2)})`;
      });
      console.log(`${name}: ${buf.duration.toFixed(1)}s rendered in ${ms}ms | peak ${a.peakDb.toFixed(1)} dBFS | ${a.lufs.toFixed(1)} LUFS | clipped ${a.clippedSamples}\n  ${per.join('  ')}`);
      if (OUT) writeFileSync(`${OUT}/${name}.wav`, Buffer.from(encodeWav(buf, 16)));
      expect(a.peakDb).toBeLessThan(0);
      expect(a.lufs).toBeGreaterThan(-30);
      expect(a.clippedSamples).toBe(0);
    }, 240000);
  }
});
