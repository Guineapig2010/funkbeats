/** Public entry points of the local composition engine. */
import type { GenerationSettings, Project } from '../model/schema';
import { parsePrompt, type Brief } from './prompt';
import { planSong, songTitle } from './plan';
import { realizeSpec } from './realize';
import type { CompositionSpec } from './spec';

export const DEFAULT_SETTINGS: GenerationSettings = {
  prompt: '', genre: 'auto', mood: 'auto', durationSec: 120, bpm: 0, key: 'auto', vocals: 'none',
  complexity: 0.5, energy: 0.6, creativity: 0.5, instrumentation: 'auto', structure: 'auto', seed: 1, engine: 'local',
};

export interface ComposeResult { project: Project; spec: CompositionSpec; brief: Brief; report: string[] }

export function planFromSettings(settings: GenerationSettings): { spec: CompositionSpec; brief: Brief } {
  const brief = parsePrompt(settings.prompt, settings);
  const spec = planSong(brief, settings.seed);
  spec.title = songTitle(brief, settings.seed);
  return { spec, brief };
}

/** Compose a complete, original arrangement locally (no network, no API key). */
export function composeLocal(settings: GenerationSettings): ComposeResult {
  const { spec, brief } = planFromSettings(settings);
  return finish(spec, brief, settings);
}

export function composeFromSpec(spec: CompositionSpec, settings: GenerationSettings): ComposeResult {
  const brief = parsePrompt(settings.prompt, settings);
  return finish(spec, brief, settings);
}

function finish(spec: CompositionSpec, brief: Brief, settings: GenerationSettings): ComposeResult {
  const project = realizeSpec(spec, spec.title);
  project.generation = { ...settings };
  const report = describeSpec(spec);
  if (brief.vocals !== 'none') {
    report.push(settings.vocals === 'ai'
      ? 'Vocals: a guide melody with aligned lyrics was written. Rendering real singing requires a connected vocal provider (see Vocals panel).'
      : 'Vocals: a guide melody with aligned lyrics was written on the "Lead Vocal – guide" track. Record a singer over it, or connect a vocal provider. The guide synth is not singing.');
  }
  report.push(...brief.notes);
  return { project, spec, brief, report };
}

export function describeSpec(spec: CompositionSpec): string[] {
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const bars = spec.sections.reduce((a, s) => a + s.bars, 0);
  const beatsPerBar = (spec.timeSignature.numerator * 4) / spec.timeSignature.denominator;
  const sec = Math.round((bars * beatsPerBar * 60) / spec.bpm);
  return [
    `${spec.genre} · ${spec.mood} · ${spec.bpm} BPM · ${names[spec.key.tonic]} ${spec.key.mode} · ${spec.timeSignature.numerator}/${spec.timeSignature.denominator}`,
    `Form (${bars} bars, ~${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}): ${spec.sections.map((s) => s.name).join(' → ')}`,
    `Parts: ${spec.tracks.map((t) => t.name).join(', ')}`,
  ];
}
