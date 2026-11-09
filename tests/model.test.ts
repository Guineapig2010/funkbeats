import { describe, expect, it } from 'vitest';
import { newMidiClip, newNote, newProject, newTrack, parseProject, ProjectValidationError, serializeProject } from '../src/model/factory';
import { clearRange, expandClipNotes, quantizeNotes, splitClip, swingOffset, trimClipEnd, trimClipStart, duplicateClip, mapNotesInRange, humanizeNotes } from '../src/model/clipOps';
import { MeterMap, TempoMap, formatBarsBeats } from '../src/model/tempo';
import { composeLocal, DEFAULT_SETTINGS } from '../src/compose/composer';
import { validateSpec } from '../src/compose/spec';
import { planFromSettings } from '../src/compose/composer';

describe('tempo & meter maps', () => {
  it('converts beats/seconds with tempo changes', () => {
    const tm = new TempoMap(120, [{ beat: 8, bpm: 60 }]);
    expect(tm.beatToSec(8)).toBeCloseTo(4);
    expect(tm.beatToSec(10)).toBeCloseTo(6);
    expect(tm.secToBeat(6)).toBeCloseTo(10);
    for (const b of [0, 3.3, 8, 17.25]) expect(tm.secToBeat(tm.beatToSec(b))).toBeCloseTo(b);
  });
  it('handles time signature changes on bar lines', () => {
    const mm = new MeterMap({ numerator: 4, denominator: 4 }, [{ beat: 8, numerator: 3, denominator: 4 }]);
    expect(mm.barToBeat(2)).toBe(8);
    expect(mm.barToBeat(3)).toBe(11);
    expect(mm.beatToBar(12).bar).toBe(3);
    expect(formatBarsBeats(9, mm)).toBe('3.2.00');
  });
});

describe('timeline clip editing', () => {
  const clip = () => newMidiClip(4, 8, [newNote(60, 0, 1), newNote(62, 3, 1), newNote(64, 6, 2)]);
  it('split keeps every note exactly once at the same absolute time', () => {
    const c = clip();
    const [a, b] = splitClip(c, 8)!;
    const abs = [...expandClipNotes(a), ...expandClipNotes(b)].map((n) => [n.pitch, n.start]);
    expect(abs).toEqual(expandClipNotes(c).map((n) => [n.pitch, n.start]));
    expect(a.length + b.length).toBe(8);
    expect(splitClip(c, 4)).toBeNull();
  });
  it('trimming the start hides content but keeps it in place', () => {
    const t = trimClipStart(clip(), 7.5);
    expect(t.start).toBe(7.5);
    expect(t.offset).toBe(3.5);
    expect(expandClipNotes(t).map((n) => n.start)).toEqual([10]);
    expect(trimClipEnd(clip(), 9).length).toBe(5);
  });
  it('looping repeats the content', () => {
    const c = { ...newMidiClip(0, 8, [newNote(60, 0, 0.5)]), loop: true, contentLength: 2 };
    expect(expandClipNotes(c).map((n) => n.start)).toEqual([0, 2, 4, 6]);
  });
  it('swing delays only off-beat 16ths', () => {
    expect(swingOffset(0.25, 1)).toBeCloseTo(1 / 12);
    expect(swingOffset(0.5, 1)).toBe(0);
    expect(swingOffset(0.25, 0)).toBe(0);
  });
  it('quantize, humanize, duplicate', () => {
    const q = quantizeNotes([newNote(60, 1.13, 1), newNote(60, 2.9, 1)], 0.25);
    expect(q.map((n) => n.start)).toEqual([1.25, 3]);
    const h = humanizeNotes([newNote(60, 1, 1, 0.8)], 1, 3);
    expect(h[0].start).not.toBe(1);
    const d = duplicateClip(clip());
    expect(d.start).toBe(12);
    expect(d.notes[0].id).not.toBe(clip().notes[0].id);
  });
  it('clearRange splits overlapping clips and mapNotesInRange is region-limited', () => {
    const t = { ...newTrack({ preset: 'synth-piano' }), clips: [clip()] };
    const cleared = clearRange(t, 6, 9);
    const starts = cleared.clips.flatMap((c) => expandClipNotes(c).map((n) => n.start)).sort((a, b) => a - b);
    expect(starts).toEqual([4, 10]);
    const up = mapNotesInRange(t, 6, 9, (ns) => ns.map((n) => ({ ...n, pitch: n.pitch + 12 })));
    expect(up.clips[0].notes.map((n) => n.pitch).sort()).toEqual([60, 64, 74].sort());
  });
});

describe('project serialization & validation', () => {
  it('round-trips a generated project exactly', () => {
    const { project } = composeLocal({ ...DEFAULT_SETTINGS, prompt: 'funk groove', seed: 9 });
    const again = parseProject(JSON.parse(serializeProject(project)));
    expect(again).toEqual(project);
  });
  it('rejects invalid data with readable issues', () => {
    const p = newProject() as any;
    p.bpm = 'fast';
    p.tracks = [{ id: 1 }];
    try { parseProject(p); throw new Error('should fail'); } catch (e) {
      expect(e).toBeInstanceOf(ProjectValidationError);
      expect((e as ProjectValidationError).issues.join('\n')).toMatch(/bpm/);
    }
    expect(() => parseProject({ hello: 'world' })).toThrow();
  });
  it('fills defaults for older files missing newer optional fields', () => {
    const p = JSON.parse(serializeProject(newProject())) as any;
    delete p.style;
    delete p.metronome;
    expect(parseProject(p).metronome.countInBars).toBe(1);
  });
});

describe('composition spec validation (AI format)', () => {
  it('accepts the local planner output and rejects malformed specs', () => {
    const { spec } = planFromSettings({ ...DEFAULT_SETTINGS, prompt: 'sad piano', seed: 2 });
    expect(validateSpec(spec).ok).toBe(true);
    const bad = validateSpec({ ...spec, bpm: 900, tracks: [{ name: 'x', role: 'melody', preset: 'not-a-preset' }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(' ')).toMatch(/bpm|preset/);
  });
});

describe('Claude-style specs with explicit parts', () => {
  it('applies parts by section name and by kind; engine fills the rest', async () => {
    const { composeFromSpec } = await import('../src/compose/composer');
    const r = validateSpec({
      title: 'Spec Test', genre: 'pop', mood: 'happy', bpm: 110, key: { tonic: 7, mode: 'major' }, timeSignature: { numerator: 4, denominator: 4 },
      sections: [
        { name: 'Verse 1', kind: 'verse', bars: 4, energy: 0.5, chords: ['G', 'D', 'Em', 'C'], roles: ['drums', 'bass', 'chords', 'melody'] },
        { name: 'Chorus 1', kind: 'chorus', bars: 4, energy: 0.9, chords: ['C', 'G', 'D', 'G'], roles: ['drums', 'bass', 'chords', 'melody'] },
        { name: 'Chorus 2', kind: 'chorus', bars: 4, energy: 1, chords: ['C', 'G', 'D', 'G'], roles: [] },
      ],
      tracks: [{ name: 'Lead', role: 'melody', preset: 'saw-lead' }, { name: 'Keys', role: 'chords', preset: 'synth-piano', comp: 'block' }, { name: 'Bass', role: 'bass', preset: 'synth-bass' }, { name: 'Drums', role: 'drums', preset: 'kit-electronic' }],
      drums: 'backbeat', bass: 'syncopated',
      parts: [
        { track: 'Lead', section: 'Verse 1', notes: [{ pitch: 'G4', start: 0, duration: 1 }, { pitch: 'B4', start: 1, duration: 1 }] },
        { track: 'Lead', section: 'chorus', notes: [{ pitch: 74, start: 0, duration: 2, velocity: 0.9 }] },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { project } = composeFromSpec(r.spec, { ...DEFAULT_SETTINGS, engine: 'claude' });
    const lead = project.tracks.find((t) => t.name === 'Lead')!;
    const bySection = (name: string) => lead.clips.filter((c) => c.name === name).flatMap((c) => c.notes.map((n) => n.pitch));
    expect(bySection('Verse 1')).toEqual([67, 71]);
    expect(bySection('Chorus 1')).toEqual([74]);
    expect(bySection('Chorus 2')).toEqual([74]);
    expect(project.tracks.find((t) => t.name === 'Drums')!.clips.flatMap((c) => c.notes).length).toBeGreaterThan(20);
    expect(project.chords.map((c) => c.symbol).slice(0, 4)).toEqual(['G', 'D', 'Em', 'C']);
  });
});
