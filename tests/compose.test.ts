import { describe, expect, it } from 'vitest';
import { composeLocal, DEFAULT_SETTINGS } from '../src/compose/composer';
import { parsePrompt } from '../src/compose/prompt';
import { ProjectSchema } from '../src/model/schema';
import { inScale, SCALES } from '../src/theory/theory';
import { TempoMap } from '../src/model/tempo';

const gen = (prompt: string, extra: Partial<typeof DEFAULT_SETTINGS> = {}) => composeLocal({ ...DEFAULT_SETTINGS, prompt, seed: 42, ...extra });

describe('prompt parsing', () => {
  it('understands genre, mood, instruments, duration', () => {
    const b = parsePrompt('Create a two-minute heroic orchestral soundtrack with emotional strings, bold brass, cinematic percussion, and a massive final climax.');
    expect(b.genre).toBe('orchestral');
    expect(b.mood).toBe('heroic');
    expect(b.durationSec).toBe(120);
    expect(b.wantsClimax).toBe(true);
    expect(b.instruments.map((i) => i.role)).toEqual(expect.arrayContaining(['strings', 'brass', 'percussion']));
  });
  it('tempo and key in text', () => {
    const b = parsePrompt('lofi beat at 82 bpm in F minor, 90 seconds');
    expect(b.genre).toBe('lofi');
    expect(b.bpm).toBe(82);
    expect(b.key).toEqual({ tonic: 5, mode: 'minor' });
    expect(b.durationSec).toBe(90);
  });
  it('does not read mood words inside other words ("funk" is not "fun")', () => {
    const b = parsePrompt('dark brazilian trap funk with stops before the drop');
    expect(b.genre).toBe('brfunk');
    expect(b.mood).toBe('dark');
    expect(parsePrompt('a fun summer song').mood).toBe('happy');
  });
  it('detects vocals and rain', () => {
    const b = parsePrompt('Intense rock anthem with electric guitars, emotional male vocals, and an explosive chorus.');
    expect(b.genre).toBe('rock');
    expect(b.vocals).toBe('recorded');
    expect(b.vocalVoice).toBe('male');
    expect(parsePrompt('Peaceful piano music with rain ambience and soft strings').wantsAmbience).toBe('rain');
  });
});

describe('local composer', () => {
  const cases = [
    'Create a two-minute heroic orchestral soundtrack with emotional strings, bold brass, cinematic percussion, and a massive final climax.',
    'Create an energetic electronic dance track with powerful bass, detailed percussion, and a catchy melody.',
    'Create an intense rock anthem with electric guitars, emotional male vocals, and an explosive chorus.',
    'Create peaceful piano music with rain ambience and soft strings.',
    'dark trap beat', 'slowed pluggnb baile funk with dreamy plugg lead', 'hard brazilian trap funk at 136 bpm', 'smooth jazz', 'lofi hip hop to study', 'synthwave night drive', 'country song', 'ambient soundscape', 'metal', 'funk groove', 'experimental glitch',
  ];
  for (const prompt of cases) {
    it(`produces a valid, coherent arrangement: ${prompt.slice(0, 40)}`, () => {
      const { project, spec } = gen(prompt);
      expect(() => ProjectSchema.parse(project)).not.toThrow();
      expect(project.tracks.length).toBeGreaterThanOrEqual(3);
      expect(project.sections.length).toBeGreaterThanOrEqual(2);
      const noteCount = project.tracks.reduce((a, t) => a + t.clips.reduce((b, c) => b + c.notes.length, 0), 0);
      expect(noteCount).toBeGreaterThan(50);
      // multiple parts sound together in the main section
      const big = project.sections.reduce((a, s) => (s.energy > a.energy ? s : a));
      const active = project.tracks.filter((t) => t.clips.some((c) => c.start < big.start + big.length && c.start + c.length > big.start && c.notes.length));
      expect(active.length).toBeGreaterThanOrEqual(3);
      // melodic tracks are in key (allow chromatic approach tones in bass/jazz)
      const mel = project.tracks.find((t) => t.role === 'melody' || t.role === 'vocal');
      if (mel && !['jazz', 'experimental'].includes(spec.genre)) {
        const notes = mel.clips.flatMap((c) => c.notes);
        const inKey = notes.filter((n) => inScale(n.pitch, project.key.tonic, project.key.mode)).length;
        const mod = project.sections.some((s) => s.transpose);
        expect(inKey / Math.max(1, notes.length)).toBeGreaterThan(mod ? 0.6 : 0.85);
      }
      // duration roughly matches request (2 min default)
      const end = project.sections.reduce((m, s) => Math.max(m, s.start + s.length), 0);
      const sec = TempoMap.fromProject(project).beatToSec(end);
      expect(sec).toBeGreaterThan(60);
      expect(sec).toBeLessThan(220);
    });
  }

  it('is deterministic for a given seed and varies with seed', () => {
    const a = gen('pop song');
    const b = gen('pop song');
    const c = composeLocal({ ...DEFAULT_SETTINGS, prompt: 'pop song', seed: 7 });
    const sig = (p: typeof a.project) => p.tracks.map((t) => t.clips.map((c) => c.notes.map((n) => n.pitch).join(',')).join('|')).join('#');
    expect(sig(a.project)).toBe(sig(b.project));
    expect(sig(a.project)).not.toBe(sig(c.project));
  });

  it('respects duration control', () => {
    const short = gen('edm', { durationSec: 45 });
    const long = gen('edm', { durationSec: 240 });
    const len = (p: typeof short.project) => TempoMap.fromProject(p).beatToSec(p.sections.reduce((m, s) => Math.max(m, s.start + s.length), 0));
    expect(len(short.project)).toBeLessThan(80);
    expect(len(long.project)).toBeGreaterThan(180);
  });

  it('orchestral uses orchestral percussion, not an electronic beat', () => {
    const { project } = gen('heroic orchestral soundtrack');
    const perc = project.tracks.find((t) => t.role === 'percussion');
    expect(perc?.instrument.kit).toBe('orchestral');
    const pitches = new Set(perc!.clips.flatMap((c) => c.notes.map((n) => n.pitch)));
    expect(pitches.has(35)).toBe(true); // taiko
    expect(project.tracks.some((t) => t.type === 'drums' && t.instrument.kit === 'electronic')).toBe(false);
  });

  it('vocals produce a guide track with lyric syllables', () => {
    const { project } = gen('pop song with female vocals', { vocals: 'recorded' });
    const v = project.tracks.find((t) => t.role === 'vocal')!;
    expect(v).toBeTruthy();
    const withLyrics = v.clips.flatMap((c) => c.notes).filter((n) => n.lyric);
    expect(withLyrics.length).toBeGreaterThan(10);
    expect(project.lyrics.sections.length).toBeGreaterThan(0);
  });
});
