import { describe, expect, it } from 'vitest';
import { applyCommands, validateCommands } from '../src/ai/commands';
import { localAssistant } from '../src/ai/localAssistant';
import { composeLocal, DEFAULT_SETTINGS } from '../src/compose/composer';
import { extendSong, improveChords, improveMelody, regenerateSections } from '../src/compose/transform';
import { ProjectSchema } from '../src/model/schema';

const base = () => composeLocal({ ...DEFAULT_SETTINGS, prompt: 'energetic pop song with piano', seed: 11, durationSec: 60 }).project;
const ctx = { selection: null, selectedTrackIds: [], seed: 5 };

describe('AI command validation', () => {
  it('rejects unknown ops, out-of-range values and code', () => {
    const v = validateCommands({ commands: [{ op: 'set_tempo', bpm: 128 }, { op: 'eval', code: 'alert(1)' }, { op: 'set_tempo', bpm: 9999 }, 'rm -rf /'] });
    expect(v.commands).toHaveLength(1);
    expect(v.errors).toHaveLength(3);
    expect(validateCommands('nope').errors[0]).toMatch(/commands/);
  });
  it('applies a realistic batch and keeps the project schema-valid', () => {
    const p = base();
    const { commands } = validateCommands([
      { op: 'set_tempo', bpm: 100 },
      { op: 'add_track', instrument: 'choir' },
      { op: 'adjust_volume', track: 'bass', delta_db: 3 },
      { op: 'add_effect', target: 'master', type: 'saturation', params: { drive: 3 } },
      { op: 'improve', aspect: 'melody', range: { section: 'chorus' } },
      { op: 'energy', delta: 0.2, range: { from_bar: 1, to_bar: 8 } },
      { op: 'set_chords', section: 'verse', chords: ['Am', 'F', 'C', 'G'] },
      { op: 'write_notes', track: 'lead', start_bar: 2, length_bars: 1, notes: [{ pitch: 'C5', start: 0, duration: 1 }, { pitch: 76, start: 1, duration: 2 }] },
      { op: 'set_track', track: 'nonexistent instrument xyz', mute: true },
    ]);
    const r = applyCommands(p, commands, ctx);
    expect(r.project.bpm).toBe(100);
    expect(r.project.tracks.length).toBe(p.tracks.length + 1);
    expect(r.project.master.effects.some((e) => e.type === 'saturation')).toBe(true);
    expect(r.errors, r.errors.join('; ')).toHaveLength(1);
    expect(r.applied.length).toBe(8);
    expect(() => ProjectSchema.parse(r.project)).not.toThrow();
  });
});

describe('region-limited regeneration', () => {
  it('regenerating one section leaves others untouched', () => {
    const p = base();
    const si = p.sections.findIndex((s) => s.kind === 'chorus');
    const s = p.sections[si];
    const outside = (q: typeof p) => JSON.stringify(q.tracks.map((t) => t.clips.filter((c) => c.start + c.length <= s.start || c.start >= s.start + s.length)));
    const inside = (q: typeof p) => JSON.stringify(q.tracks.map((t) => t.clips.filter((c) => c.start >= s.start && c.start < s.start + s.length).map((c) => c.notes.map((n) => n.pitch))));
    const r = regenerateSections(p, [si], { seed: 999 });
    expect(outside(r)).toBe(outside(p));
    expect(inside(r)).not.toBe(inside(p));
  });
  it('improve chords changes harmony only in the chosen section; melody keeps its rhythm', () => {
    const p = base();
    const si = p.sections.findIndex((s) => s.kind === 'verse');
    const r = improveChords(p, [si], 1234);
    const s = p.sections[si];
    const ch = (q: typeof p, inS: boolean) => q.chords.filter((c) => (c.start >= s.start && c.start < s.start + s.length) === inS).map((c) => c.symbol).join();
    expect(ch(r, false)).toBe(ch(p, false));
    const mel = (q: typeof p) => q.tracks.find((t) => t.role === 'melody')!.clips.filter((c) => c.sectionId === s.id).flatMap((c) => c.notes.map((n) => n.start));
    expect(mel(r)).toEqual(mel(p));
    expect(improveMelody(p, [si], 77).tracks.length).toBe(p.tracks.length);
  });
  it('extend appends real music', () => {
    const p = base();
    const r = extendSong(p, 8, 3);
    const end = (q: typeof p) => q.sections.reduce((m, s) => Math.max(m, s.start + s.length), 0);
    expect(end(r)).toBeGreaterThan(end(p));
    expect(r.tracks.reduce((a, t) => a + t.clips.length, 0)).toBeGreaterThan(p.tracks.reduce((a, t) => a + t.clips.length, 0));
  });
});

describe('local assistant', () => {
  const p = base();
  const cases: [string, string][] = [
    ['The bass sounds too weak', 'adjust_volume'],
    ['Give the chorus a completely different melody', 'improve'],
    ['Make this sound more like a movie soundtrack', 'make_cinematic'],
    ['add a choir and strings', 'add_track'],
    ['make it jazz', 'change_genre'],
    ['tempo 128 bpm', 'set_tempo'],
    ['extend by 8 bars', 'extend'],
    ['humanize the drums', 'humanize'],
  ];
  for (const [text, op] of cases) it(`"${text}" → ${op}`, () => {
    expect(localAssistant(text, p, false).commands.map((c) => c.op)).toContain(op);
  });
  it('is honest when it cannot help', () => {
    const r = localAssistant('sing it like Freddie Mercury', p, false);
    expect(r.commands).toHaveLength(0);
    expect(r.reply).toMatch(/Local assistant/);
  });
  it('dramatic selection request maps to energy + strings + rhythm on the selection', () => {
    const r = localAssistant('Make these eight bars much more dramatic, add a rising string section, and give the drums a more powerful rhythm.', p, true);
    const ops = r.commands.map((c) => c.op);
    expect(ops).toEqual(expect.arrayContaining(['energy', 'improve', 'regenerate']));
    expect(r.commands.every((c) => !('range' in c) || (c as any).range?.selection)).toBe(true);
  });
});
