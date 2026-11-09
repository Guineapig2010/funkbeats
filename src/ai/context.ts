/** Compact structured project summary sent to Claude (no audio, bounded size). */
import { MeterMap } from '../model/tempo';
import type { Project } from '../model/schema';
import { NOTE_NAMES } from '../theory/theory';
import { trackNotesInRange } from '../model/clipOps';

export function projectContext(p: Project, sel: { from: number; to: number } | null, selectedTrackIds: string[]) {
  const meter = MeterMap.fromProject(p);
  const bar = (beat: number) => meter.beatToBar(beat).bar + 1;
  const ctx = {
    name: p.name,
    bpm: p.bpm,
    key: `${NOTE_NAMES[p.key.tonic]} ${p.key.mode}`,
    timeSignature: `${p.timeSignature.numerator}/${p.timeSignature.denominator}`,
    genre: p.style?.genre ?? p.generation?.genre ?? 'unknown',
    mood: p.style?.mood ?? 'unknown',
    mastering: p.master.preset,
    masterEffects: p.master.effects.map((e) => e.type),
    sections: p.sections.map((s) => ({
      name: s.name, kind: s.kind, bars: `${bar(s.start)}-${bar(s.start + s.length) - 1}`, energy: Math.round(s.energy * 100) / 100,
      chords: p.chords.filter((c) => c.start >= s.start && c.start < s.start + s.length).map((c) => c.symbol).join(' '),
    })),
    tracks: p.tracks.map((t) => ({
      name: t.name, role: t.role, type: t.type, preset: t.instrument.preset, source: t.instrument.source, volume_db: Math.round(t.volume * 10) / 10, pan: t.pan,
      mute: t.mute || undefined, solo: t.solo || undefined, effects: t.effects.map((e) => e.type), sends: Object.fromEntries(t.sends.map((s) => [s.returnId, s.level])),
      notes: t.clips.reduce((a, c) => a + c.notes.length, 0), audioClips: t.clips.filter((c) => c.kind === 'audio').length || undefined,
      playsIn: p.sections.filter((s) => t.clips.some((c) => c.start < s.start + s.length && c.start + c.length > s.start && (c.notes.length || c.audio))).map((s) => s.name),
      selected: selectedTrackIds.includes(t.id) || undefined,
      synth: t.type === 'instrument' ? { cutoff: t.instrument.params.filter.cutoff, attack: t.instrument.params.ampEnv.attack, release: t.instrument.params.ampEnv.release, gain: t.instrument.params.gain } : undefined,
    })),
    returns: p.returns.map((r) => ({ name: r.name, effects: r.effects.map((e) => e.type), volume_db: r.volume })),
    lyrics: p.lyrics.sections.map((l) => ({ section: l.label, text: l.text.slice(0, 400) })),
    selection: sel ? { from_bar: bar(sel.from), to_bar: Math.max(bar(sel.from), bar(sel.to - 1e-6)), sections: p.sections.filter((s) => s.start < sel.to && s.start + s.length > sel.from).map((s) => s.name) } : null,
    selectedNotes: undefined as unknown,
  };
  // include notes of the selected range for the selected (or melody) track so Claude can edit precisely
  if (sel) {
    const t = p.tracks.find((x) => selectedTrackIds.includes(x.id)) ?? p.tracks.find((x) => x.role === 'melody' || x.role === 'vocal');
    if (t) {
      const ns = trackNotesInRange(t, sel.from, sel.to).slice(0, 300);
      ctx.selectedNotes = { track: t.name, start_bar: bar(sel.from), notes: ns.map((n) => ({ pitch: n.pitch, start: Math.round((n.start - sel.from) * 1000) / 1000, duration: Math.round(n.duration * 1000) / 1000, velocity: Math.round(n.velocity * 100) / 100 })) };
    }
  }
  return ctx;
}
