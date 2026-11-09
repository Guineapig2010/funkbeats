/**
 * CompositionSpec: the validated, high-level musical plan that both the local
 * planner and Claude produce. The realizer turns it into a full editable Project.
 * Claude may optionally supply explicit notes for any part; otherwise the local
 * part generators write them from the plan.
 */
import { z } from 'zod';
import { ModeSchema, SectionKindSchema, TrackRoleSchema } from '../model/schema';
import { PRESET_MAP } from '../model/presets';

const CompStyleSchema = z.enum(['pad', 'block', 'arp', 'strum', 'stabs', 'ostinato', 'broken', 'jazz-comp', 'power', 'offbeat']);
export const DrumStyleSchema = z.enum(['none', 'four-floor', 'backbeat', 'rock', 'metal', 'trap', 'boom-bap', 'lofi', 'halftime', 'dnb', 'orchestral', 'jazz', 'country', 'funk', 'synthwave', 'ambient-perc', 'reggaeton', 'ballad', 'baile', 'funkbr']);
export const BassStyleSchema = z.enum(['root-eighths', 'octave-pump', 'walking', '808', 'sustain', 'syncopated', 'root-fifth', 'arp-bass', 'gallop', 'reese', 'baile-808', 'funk-808']);

export const SpecNoteSchema = z.object({
  pitch: z.union([z.number().int().min(0).max(127), z.string().min(2).max(4)]),
  start: z.number().min(0).max(4096),
  duration: z.number().min(1 / 64).max(256),
  velocity: z.number().min(0).max(1).default(0.8),
  lyric: z.string().max(40).optional(),
});

export const SpecSectionSchema = z.object({
  name: z.string().max(40),
  kind: SectionKindSchema,
  bars: z.number().int().min(1).max(128),
  energy: z.number().min(0).max(1),
  /** One entry per bar; an entry may hold several space-separated chords splitting the bar. Chord symbols like "Am7", "F", "G/B". */
  chords: z.array(z.string().max(40)).max(128).default([]),
  /** Roles playing in this section. Empty = decide by energy. */
  roles: z.array(TrackRoleSchema).max(24).default([]),
  /** Semitone transposition of this section relative to the song key (key changes / modulations). */
  transpose: z.number().int().min(-12).max(12).default(0),
});

export const SpecTrackSchema = z.object({
  name: z.string().max(40),
  role: TrackRoleSchema,
  preset: z.string().refine((p) => !!PRESET_MAP[p], { message: 'unknown preset id' }),
  comp: CompStyleSchema.optional(),
  /** Pitch register center (MIDI) */
  center: z.number().int().min(24).max(100).optional(),
  volume: z.number().min(-40).max(6).optional(),
  pan: z.number().min(-1).max(1).optional(),
  effects: z.array(z.string().max(30)).max(6).default([]),
});

export const SpecPartSchema = z.object({
  track: z.string().max(40),
  section: z.string().max(40),
  notes: z.array(SpecNoteSchema).max(2000),
});

export const CompositionSpecSchema = z.object({
  title: z.string().max(80),
  genre: z.string().max(40),
  mood: z.string().max(40),
  bpm: z.number().min(40).max(220),
  key: z.object({ tonic: z.number().int().min(0).max(11), mode: ModeSchema }),
  timeSignature: z.object({ numerator: z.number().int().min(2).max(15), denominator: z.union([z.literal(4), z.literal(8)]) }),
  sections: z.array(SpecSectionSchema).min(1).max(48),
  tracks: z.array(SpecTrackSchema).min(1).max(24),
  drums: DrumStyleSchema,
  bass: BassStyleSchema,
  swing: z.number().min(0).max(1).default(0),
  melodyDensity: z.number().min(0).max(1).default(0.5),
  syncopation: z.number().min(0).max(1).default(0.3),
  complexity: z.number().min(0).max(1).default(0.5),
  creativity: z.number().min(0).max(1).default(0.5),
  mastering: z.string().max(30).default('clean'),
  ritardando: z.boolean().default(false),
  seed: z.number().int().default(1),
  parts: z.array(SpecPartSchema).max(200).default([]),
  lyrics: z.array(z.object({ section: z.string().max(40), text: z.string().max(2000) })).max(24).default([]),
  vocalStyle: z.object({ voice: z.enum(['any', 'male', 'female', 'choir']), delivery: z.string().max(60) }).optional(),
  notes: z.string().max(2000).default(''),
});
export type CompositionSpec = z.infer<typeof CompositionSpecSchema>;
export type SpecSection = z.infer<typeof SpecSectionSchema>;
export type SpecTrack = z.infer<typeof SpecTrackSchema>;

export function validateSpec(data: unknown): { ok: true; spec: CompositionSpec } | { ok: false; errors: string[] } {
  const r = CompositionSpecSchema.safeParse(data);
  if (r.success) return { ok: true, spec: r.data };
  return { ok: false, errors: r.error.issues.slice(0, 25).map((i) => `${i.path.join('.')}: ${i.message}`) };
}
