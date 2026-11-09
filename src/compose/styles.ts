/** Genre and mood knowledge used by the local composer. */
import type { ModeName, SectionKind, TrackRole } from '../model/schema';

export type DrumStyle = 'none' | 'four-floor' | 'backbeat' | 'rock' | 'metal' | 'trap' | 'boom-bap' | 'lofi' | 'halftime' | 'dnb' | 'orchestral' | 'jazz' | 'country' | 'funk' | 'synthwave' | 'ambient-perc' | 'reggaeton' | 'ballad';
export type BassStyle = 'root-eighths' | 'octave-pump' | 'walking' | '808' | 'sustain' | 'syncopated' | 'root-fifth' | 'arp-bass' | 'gallop' | 'reese';
export type CompStyle = 'pad' | 'block' | 'arp' | 'strum' | 'stabs' | 'ostinato' | 'broken' | 'jazz-comp' | 'power' | 'offbeat';

export interface RoleSpec {
  role: TrackRole;
  name: string;
  preset: string;
  comp?: CompStyle;
  /** Minimum section energy (0..1) for this part to play. */
  minEnergy: number;
  /** Section kinds where the part is always silent. */
  skip?: SectionKind[];
  /** Register center (MIDI). */
  center?: number;
  effects?: string[];
  volume?: number;
}

export interface GenreStyle {
  id: string;
  label: string;
  bpm: [number, number];
  majorModes: ModeName[];
  minorModes: ModeName[];
  preferMinor: number; // probability of minor family when mood is neutral
  keys: number[]; // preferred tonics
  timeSig: [number, 4 | 8];
  chordSize: 3 | 4 | 5;
  harmonicRhythm: number; // chords per bar (1 or 2)
  progMajor: string[][];
  progMinor: string[][];
  structure: { kind: SectionKind; bars: number; energy: number; optional?: boolean }[];
  roles: RoleSpec[];
  drums: DrumStyle;
  bass: BassStyle;
  melodyDensity: number; // 0..1
  syncopation: number; // 0..1
  swing: number;
  mastering: string;
  reverb: number; // 0..1 send scale
  /** If set, uses a ritardando into the final bars. */
  ritardando?: boolean;
  /** Final chorus modulates up (semitones). */
  liftFinal?: number;
}

const P = (s: string) => s.split(' ');

export const GENRES: Record<string, GenreStyle> = {
  pop: {
    id: 'pop', label: 'Pop', bpm: [96, 124], majorModes: ['major'], minorModes: ['minor'], preferMinor: 0.3, keys: [0, 2, 7, 9, 5, 4],
    timeSig: [4, 4], chordSize: 3, harmonicRhythm: 1,
    progMajor: [P('I V vi IV'), P('vi IV I V'), P('I vi IV V'), P('IV I V vi'), P('I IV vi V'), P('I V IV IV')],
    progMinor: [P('i VI III VII'), P('i iv VI V'), P('VI VII i i'), P('i VII VI VII')],
    structure: [
      { kind: 'intro', bars: 4, energy: 0.35 }, { kind: 'verse', bars: 8, energy: 0.5 }, { kind: 'prechorus', bars: 4, energy: 0.65, optional: true },
      { kind: 'chorus', bars: 8, energy: 0.85 }, { kind: 'verse', bars: 8, energy: 0.55, optional: true }, { kind: 'prechorus', bars: 4, energy: 0.7, optional: true },
      { kind: 'chorus', bars: 8, energy: 0.9 }, { kind: 'bridge', bars: 8, energy: 0.55, optional: true }, { kind: 'chorus', bars: 8, energy: 1 }, { kind: 'outro', bars: 4, energy: 0.35 },
    ],
    roles: [
      { role: 'drums', name: 'Drums', preset: 'kit-electronic', minEnergy: 0.4, skip: ['intro'] },
      { role: 'bass', name: 'Bass', preset: 'synth-bass', minEnergy: 0.4 },
      { role: 'chords', name: 'Piano', preset: 'synth-piano', comp: 'block', minEnergy: 0 },
      { role: 'pad', name: 'Pad', preset: 'warm-pad', comp: 'pad', minEnergy: 0.6 },
      { role: 'melody', name: 'Lead', preset: 'sine-lead', minEnergy: 0.45, skip: ['intro', 'outro'] },
      { role: 'arp', name: 'Pluck Arp', preset: 'pluck', comp: 'arp', minEnergy: 0.8 },
    ],
    drums: 'backbeat', bass: 'syncopated', melodyDensity: 0.55, syncopation: 0.45, swing: 0, mastering: 'pop', reverb: 0.8, liftFinal: 1,
  },
  rock: {
    id: 'rock', label: 'Rock', bpm: [108, 148], majorModes: ['major', 'mixolydian'], minorModes: ['minor'], preferMinor: 0.5, keys: [4, 9, 2, 7, 0],
    timeSig: [4, 4], chordSize: 3, harmonicRhythm: 1,
    progMajor: [P('I bVII IV I'), P('I V vi IV'), P('I IV V IV'), P('IV I V V')],
    progMinor: [P('i VI III VII'), P('i VII VI VII'), P('i iv VII III'), P('i III VII iv')],
    structure: [
      { kind: 'intro', bars: 4, energy: 0.6 }, { kind: 'verse', bars: 8, energy: 0.6 }, { kind: 'prechorus', bars: 4, energy: 0.75, optional: true },
      { kind: 'chorus', bars: 8, energy: 0.95 }, { kind: 'verse', bars: 8, energy: 0.65, optional: true }, { kind: 'chorus', bars: 8, energy: 0.95 },
      { kind: 'solo', bars: 8, energy: 0.9, optional: true }, { kind: 'bridge', bars: 8, energy: 0.6, optional: true }, { kind: 'chorus', bars: 8, energy: 1 }, { kind: 'outro', bars: 4, energy: 0.7 },
    ],
    roles: [
      { role: 'drums', name: 'Drums', preset: 'kit-rock', minEnergy: 0 },
      { role: 'bass', name: 'Bass Guitar', preset: 'pick-bass', minEnergy: 0 },
      { role: 'chords', name: 'Rhythm Guitar', preset: 'dist-guitar', comp: 'power', minEnergy: 0, effects: ['guitar'] },
      { role: 'melody', name: 'Lead Guitar', preset: 'dist-guitar', minEnergy: 0.5, skip: ['intro'], effects: ['lead-guitar'] },
      { role: 'pad', name: 'Organ', preset: 'organ-full', comp: 'pad', minEnergy: 0.85 },
    ],
    drums: 'rock', bass: 'root-eighths', melodyDensity: 0.55, syncopation: 0.35, swing: 0, mastering: 'rock', reverb: 0.5,
  },
  metal: {
    id: 'metal', label: 'Metal', bpm: [130, 180], majorModes: ['phrygian'], minorModes: ['minor', 'phrygian', 'harmonicMinor'], preferMinor: 1, keys: [4, 2, 9, 7],
    timeSig: [4, 4], chordSize: 3, harmonicRhythm: 2,
    progMajor: [P('i bII i bVII')], progMinor: [P('i bII i bVII'), P('i VI VII i'), P('i iv VI V'), P('i i bII bVII')],
    structure: [
      { kind: 'intro', bars: 4, energy: 0.8 }, { kind: 'verse', bars: 8, energy: 0.85 }, { kind: 'chorus', bars: 8, energy: 1 },
      { kind: 'verse', bars: 8, energy: 0.85, optional: true }, { kind: 'chorus', bars: 8, energy: 1 }, { kind: 'breakdown', bars: 8, energy: 0.9, optional: true },
      { kind: 'solo', bars: 8, energy: 1, optional: true }, { kind: 'chorus', bars: 8, energy: 1 }, { kind: 'outro', bars: 4, energy: 0.8 },
    ],
    roles: [
      { role: 'drums', name: 'Drums', preset: 'kit-rock', minEnergy: 0 },
      { role: 'bass', name: 'Bass', preset: 'pick-bass', minEnergy: 0 },
      { role: 'chords', name: 'Rhythm Guitar', preset: 'dist-guitar', comp: 'power', minEnergy: 0, effects: ['metal-guitar'] },
      { role: 'melody', name: 'Lead Guitar', preset: 'dist-guitar', minEnergy: 0.85, effects: ['lead-guitar'], skip: ['intro', 'breakdown'] },
    ],
    drums: 'metal', bass: 'gallop', melodyDensity: 0.7, syncopation: 0.3, swing: 0, mastering: 'rock', reverb: 0.35,
  },
  edm: {
    id: 'edm', label: 'EDM', bpm: [122, 130], majorModes: ['major'], minorModes: ['minor'], preferMinor: 0.65, keys: [9, 5, 7, 2, 0],
    timeSig: [4, 4], chordSize: 3, harmonicRhythm: 1,
    progMajor: [P('vi IV I V'), P('I V vi IV'), P('IV V vi vi')],
    progMinor: [P('i VI III VII'), P('i VII VI VII'), P('VI VII i i'), P('i iv VI VII')],
    structure: [
      { kind: 'intro', bars: 8, energy: 0.4 }, { kind: 'buildup', bars: 8, energy: 0.7 }, { kind: 'drop', bars: 16, energy: 1 },
      { kind: 'breakdown', bars: 8, energy: 0.35 }, { kind: 'buildup', bars: 8, energy: 0.75 }, { kind: 'drop', bars: 16, energy: 1 }, { kind: 'outro', bars: 8, energy: 0.45 },
    ],
    roles: [
      { role: 'drums', name: 'Drums', preset: 'kit-electronic', minEnergy: 0.38, skip: ['breakdown'] },
      { role: 'bass', name: 'Bass', preset: 'synth-bass', minEnergy: 0.6, skip: ['breakdown', 'buildup'], effects: ['pump'] },
      { role: 'pad', name: 'Supersaw Chords', preset: 'supersaw', comp: 'stabs', minEnergy: 0.3, effects: ['pump'] },
      { role: 'melody', name: 'Lead', preset: 'saw-lead', minEnergy: 0.9 },
      { role: 'arp', name: 'Arp', preset: 'arp-pluck', comp: 'arp', minEnergy: 0.4 },
      { role: 'fx', name: 'FX Riser', preset: 'noise-riser', minEnergy: 0 },
    ],
    drums: 'four-floor', bass: 'octave-pump', melodyDensity: 0.7, syncopation: 0.55, swing: 0, mastering: 'electronic', reverb: 0.7,
  },
  house: {
    id: 'house', label: 'House', bpm: [120, 126], majorModes: ['major', 'dorian'], minorModes: ['minor', 'dorian'], preferMinor: 0.5, keys: [5, 9, 0, 2],
    timeSig: [4, 4], chordSize: 4, harmonicRhythm: 1,
    progMajor: [P('ii7 V7 Imaj7 vi7'), P('Imaj7 vi7 ii7 V7')], progMinor: [P('i7 iv7 i7 VII'), P('i7 VI III VII')],
    structure: [
      { kind: 'intro', bars: 8, energy: 0.45 }, { kind: 'verse', bars: 16, energy: 0.7 }, { kind: 'breakdown', bars: 8, energy: 0.4 },
      { kind: 'drop', bars: 16, energy: 0.95 }, { kind: 'verse', bars: 8, energy: 0.7, optional: true }, { kind: 'outro', bars: 8, energy: 0.45 },
    ],
    roles: [
      { role: 'drums', name: 'Drums', preset: 'kit-electronic', minEnergy: 0.4, skip: ['breakdown'] },
      { role: 'bass', name: 'Bass', preset: 'synth-bass', minEnergy: 0.5 },
      { role: 'chords', name: 'Piano Stabs', preset: 'epiano', comp: 'offbeat', minEnergy: 0.3 },
      { role: 'pad', name: 'Pad', preset: 'warm-pad', comp: 'pad', minEnergy: 0.3 },
      { role: 'melody', name: 'Lead', preset: 'square-lead', minEnergy: 0.85 },
    ],
    drums: 'four-floor', bass: 'syncopated', melodyDensity: 0.5, syncopation: 0.6, swing: 0.1, mastering: 'electronic', reverb: 0.6,
  },
  hiphop: {
    id: 'hiphop', label: 'Hip-Hop', bpm: [84, 96], majorModes: ['dorian'], minorModes: ['minor', 'dorian'], preferMinor: 0.85, keys: [1, 3, 6, 8, 10, 0],
    timeSig: [4, 4], chordSize: 4, harmonicRhythm: 1,
    progMajor: [P('ii7 V7 Imaj7 Imaj7')], progMinor: [P('i7 iv7 i7 iv7'), P('i7 VI VII i7'), P('i7 i7 VI v7'), P('VI III VII i7')],
    structure: [
      { kind: 'intro', bars: 4, energy: 0.4 }, { kind: 'verse', bars: 16, energy: 0.7 }, { kind: 'chorus', bars: 8, energy: 0.85 },
      { kind: 'verse', bars: 16, energy: 0.7, optional: true }, { kind: 'chorus', bars: 8, energy: 0.9 }, { kind: 'outro', bars: 4, energy: 0.4 },
    ],
    roles: [
      { role: 'drums', name: 'Drums', preset: 'kit-808', minEnergy: 0.45 },
      { role: 'bass', name: '808', preset: '808-bass', minEnergy: 0.45 },
      { role: 'chords', name: 'Keys', preset: 'warm-epiano', comp: 'block', minEnergy: 0 },
      { role: 'melody', name: 'Hook', preset: 'bells', minEnergy: 0.8 },
      { role: 'pad', name: 'Strings', preset: 'string-ensemble', comp: 'pad', minEnergy: 0.8 },
    ],
    drums: 'boom-bap', bass: '808', melodyDensity: 0.4, syncopation: 0.6, swing: 0.35, mastering: 'electronic', reverb: 0.5,
  },
  trap: {
    id: 'trap', label: 'Trap', bpm: [130, 150], majorModes: ['minor'], minorModes: ['minor', 'harmonicMinor', 'phrygian'], preferMinor: 1, keys: [1, 6, 8, 11, 3],
    timeSig: [4, 4], chordSize: 3, harmonicRhythm: 1,
    progMajor: [P('i VI VII i')], progMinor: [P('i VI iv V'), P('i i VI VII'), P('i iv VI V'), P('i bII i VII')],
    structure: [
      { kind: 'intro', bars: 4, energy: 0.4 }, { kind: 'chorus', bars: 8, energy: 0.9 }, { kind: 'verse', bars: 16, energy: 0.75 },
      { kind: 'chorus', bars: 8, energy: 0.95 }, { kind: 'verse', bars: 8, energy: 0.75, optional: true }, { kind: 'chorus', bars: 8, energy: 1 }, { kind: 'outro', bars: 4, energy: 0.4 },
    ],
    roles: [
      { role: 'drums', name: 'Drums', preset: 'kit-trap', minEnergy: 0.45 },
      { role: 'bass', name: '808', preset: '808-bass', minEnergy: 0.45 },
      { role: 'melody', name: 'Bell Melody', preset: 'celesta', minEnergy: 0 },
      { role: 'pad', name: 'Dark Pad', preset: 'dark-pad', comp: 'pad', minEnergy: 0 },
      { role: 'chords', name: 'Choir', preset: 'synth-choir', comp: 'pad', minEnergy: 0.85 },
    ],
    drums: 'trap', bass: '808', melodyDensity: 0.5, syncopation: 0.5, swing: 0, mastering: 'electronic', reverb: 0.5,
  },
  orchestral: {
    id: 'orchestral', label: 'Orchestral / Film Score', bpm: [72, 104], majorModes: ['major', 'lydian'], minorModes: ['minor', 'dorian', 'harmonicMinor'], preferMinor: 0.55, keys: [2, 9, 0, 7, 5, 3],
    timeSig: [4, 4], chordSize: 3, harmonicRhythm: 1,
    progMajor: [P('I V vi IV'), P('I bVII IV I'), P('IV V iii vi'), P('I iii IV V'), P('vi IV I V'), P('I bVI bVII I')],
    progMinor: [P('i VI III VII'), P('i iv VI V'), P('VI VII i i'), P('i VI iv V'), P('i III VII VI')],
    structure: [
      { kind: 'intro', bars: 4, energy: 0.3 }, { kind: 'theme', bars: 8, energy: 0.5 }, { kind: 'development', bars: 8, energy: 0.65 },
      { kind: 'buildup', bars: 4, energy: 0.8 }, { kind: 'climax', bars: 8, energy: 1 }, { kind: 'interlude', bars: 8, energy: 0.45, optional: true },
      { kind: 'theme', bars: 8, energy: 0.7, optional: true }, { kind: 'buildup', bars: 4, energy: 0.85, optional: true }, { kind: 'climax', bars: 8, energy: 1 }, { kind: 'coda', bars: 4, energy: 0.6 },
    ],
    roles: [
      { role: 'percussion', name: 'Cinematic Percussion', preset: 'kit-orchestral', minEnergy: 0.6 },
      { role: 'bass', name: 'Low Strings', preset: 'orch-basses', minEnergy: 0 },
      { role: 'strings', name: 'String Ensemble', preset: 'string-ensemble', comp: 'pad', minEnergy: 0 },
      { role: 'ostinato', name: 'Spiccato Strings', preset: 'spiccato', comp: 'ostinato', minEnergy: 0.6 },
      { role: 'melody', name: 'Violins (Theme)', preset: 'violins', minEnergy: 0.4, skip: ['intro'] },
      { role: 'brass', name: 'French Horns', preset: 'french-horns', minEnergy: 0.75 },
      { role: 'countermelody', name: 'Cellos (Counter)', preset: 'cellos', minEnergy: 0.6 },
      { role: 'pad', name: 'Choir', preset: 'synth-choir', comp: 'pad', minEnergy: 0.9 },
      { role: 'fx', name: 'Timpani', preset: 'timpani', minEnergy: 0.7 },
    ],
    drums: 'orchestral', bass: 'sustain', melodyDensity: 0.4, syncopation: 0.15, swing: 0, mastering: 'cinematic', reverb: 1, ritardando: true,
  },
  classical: {
    id: 'classical', label: 'Classical', bpm: [76, 116], majorModes: ['major'], minorModes: ['minor', 'harmonicMinor'], preferMinor: 0.4, keys: [0, 7, 2, 5, 9],
    timeSig: [4, 4], chordSize: 3, harmonicRhythm: 2,
    progMajor: [P('I IV V I'), P('I vi ii V'), P('I V vi iii IV I ii V'), P('I ii V I')],
    progMinor: [P('i iv V i'), P('i VI ii° V'), P('i iv VII III VI iv V i')],
    structure: [
      { kind: 'theme', bars: 8, energy: 0.45 }, { kind: 'theme', bars: 8, energy: 0.55 }, { kind: 'development', bars: 8, energy: 0.7 },
      { kind: 'theme', bars: 8, energy: 0.6 }, { kind: 'coda', bars: 4, energy: 0.4 },
    ],
    roles: [
      { role: 'melody', name: 'Piano RH', preset: 'synth-piano', minEnergy: 0 },
      { role: 'chords', name: 'Piano LH', preset: 'synth-piano', comp: 'broken', minEnergy: 0, center: 50 },
      { role: 'strings', name: 'Strings', preset: 'string-ensemble', comp: 'pad', minEnergy: 0.65 },
    ],
    drums: 'none', bass: 'sustain', melodyDensity: 0.6, syncopation: 0.05, swing: 0, mastering: 'classical', reverb: 0.9, ritardando: true,
  },
  jazz: {
    id: 'jazz', label: 'Jazz', bpm: [100, 160], majorModes: ['major'], minorModes: ['dorian', 'minor'], preferMinor: 0.3, keys: [5, 10, 3, 0, 7],
    timeSig: [4, 4], chordSize: 4, harmonicRhythm: 1,
    progMajor: [P('ii7 V7 Imaj7 vi7'), P('Imaj7 vi7 ii7 V7'), P('iii7 vi7 ii7 V7'), P('Imaj7 V7/ii ii7 V7')],
    progMinor: [P('i7 iv7 VII7 IIImaj7'), P('ii° V7 i7 i7'), P('i7 VI7 ii° V7')],
    structure: [
      { kind: 'intro', bars: 4, energy: 0.4 }, { kind: 'theme', bars: 8, energy: 0.55 }, { kind: 'theme', bars: 8, energy: 0.55 },
      { kind: 'bridge', bars: 8, energy: 0.6 }, { kind: 'solo', bars: 16, energy: 0.75, optional: true }, { kind: 'theme', bars: 8, energy: 0.6 }, { kind: 'outro', bars: 4, energy: 0.4 },
    ],
    roles: [
      { role: 'drums', name: 'Drums (brushes)', preset: 'kit-acoustic', minEnergy: 0.4 },
      { role: 'bass', name: 'Upright Bass (modelled)', preset: 'pick-bass', minEnergy: 0 },
      { role: 'chords', name: 'Electric Piano', preset: 'epiano', comp: 'jazz-comp', minEnergy: 0 },
      { role: 'melody', name: 'Saxophone', preset: 'sax', minEnergy: 0.45, skip: ['intro'] },
    ],
    drums: 'jazz', bass: 'walking', melodyDensity: 0.65, syncopation: 0.6, swing: 0.6, mastering: 'acoustic', reverb: 0.6,
  },
  country: {
    id: 'country', label: 'Country', bpm: [96, 128], majorModes: ['major', 'mixolydian'], minorModes: ['minor'], preferMinor: 0.15, keys: [7, 2, 9, 4, 0],
    timeSig: [4, 4], chordSize: 3, harmonicRhythm: 1,
    progMajor: [P('I IV I V'), P('I V vi IV'), P('I IV V I'), P('IV I V I')], progMinor: [P('vi IV I V')],
    structure: [
      { kind: 'intro', bars: 4, energy: 0.45 }, { kind: 'verse', bars: 8, energy: 0.55 }, { kind: 'chorus', bars: 8, energy: 0.8 },
      { kind: 'verse', bars: 8, energy: 0.6, optional: true }, { kind: 'chorus', bars: 8, energy: 0.85 }, { kind: 'solo', bars: 8, energy: 0.75, optional: true }, { kind: 'chorus', bars: 8, energy: 0.9 }, { kind: 'outro', bars: 4, energy: 0.4 },
    ],
    roles: [
      { role: 'drums', name: 'Drums', preset: 'kit-acoustic', minEnergy: 0.45 },
      { role: 'bass', name: 'Bass', preset: 'pick-bass', minEnergy: 0 },
      { role: 'chords', name: 'Acoustic Guitar', preset: 'steel-guitar', comp: 'strum', minEnergy: 0 },
      { role: 'melody', name: 'Fiddle', preset: 'violins', minEnergy: 0.5, skip: ['intro'] },
      { role: 'pad', name: 'Organ', preset: 'organ-soft', comp: 'pad', minEnergy: 0.8 },
    ],
    drums: 'country', bass: 'root-fifth', melodyDensity: 0.55, syncopation: 0.3, swing: 0.15, mastering: 'acoustic', reverb: 0.5,
  },
  ambient: {
    id: 'ambient', label: 'Ambient', bpm: [60, 84], majorModes: ['lydian', 'major'], minorModes: ['dorian', 'minor'], preferMinor: 0.4, keys: [4, 2, 9, 11, 7],
    timeSig: [4, 4], chordSize: 5, harmonicRhythm: 0.5,
    progMajor: [P('Imaj7 IVmaj7 vi7 IVmaj7'), P('I iii IV IV'), P('IV I V vi')], progMinor: [P('i7 VImaj7 III VII'), P('i7 iv7 i7 VI')],
    structure: [
      { kind: 'intro', bars: 8, energy: 0.2 }, { kind: 'theme', bars: 16, energy: 0.4 }, { kind: 'development', bars: 16, energy: 0.55 },
      { kind: 'theme', bars: 16, energy: 0.45, optional: true }, { kind: 'outro', bars: 8, energy: 0.2 },
    ],
    roles: [
      { role: 'pad', name: 'Glass Pad', preset: 'glass-pad', comp: 'pad', minEnergy: 0 },
      { role: 'strings', name: 'Warm Pad', preset: 'warm-pad', comp: 'pad', minEnergy: 0.3 },
      { role: 'arp', name: 'Bells', preset: 'celesta', comp: 'arp', minEnergy: 0.35 },
      { role: 'melody', name: 'Soft Lead', preset: 'flute', minEnergy: 0.5 },
      { role: 'bass', name: 'Drone', preset: 'drone', minEnergy: 0 },
    ],
    drums: 'none', bass: 'sustain', melodyDensity: 0.25, syncopation: 0.1, swing: 0, mastering: 'cinematic', reverb: 1.2,
  },
  lofi: {
    id: 'lofi', label: 'Lo-Fi', bpm: [72, 90], majorModes: ['major', 'dorian'], minorModes: ['dorian', 'minor'], preferMinor: 0.5, keys: [5, 3, 10, 0, 8],
    timeSig: [4, 4], chordSize: 5, harmonicRhythm: 1,
    progMajor: [P('IVmaj7 iii7 ii7 Imaj7'), P('ii7 V7 Imaj7 vi7'), P('Imaj7 vi7 IVmaj7 V7')], progMinor: [P('i7 iv7 VIImaj7 IIImaj7'), P('ii° v7 i7 i7'), P('i7 VImaj7 iv7 v7')],
    structure: [
      { kind: 'intro', bars: 4, energy: 0.35 }, { kind: 'verse', bars: 8, energy: 0.55 }, { kind: 'chorus', bars: 8, energy: 0.65 },
      { kind: 'verse', bars: 8, energy: 0.55, optional: true }, { kind: 'chorus', bars: 8, energy: 0.7 }, { kind: 'outro', bars: 4, energy: 0.35 },
    ],
    roles: [
      { role: 'drums', name: 'Dusty Drums', preset: 'kit-lofi', minEnergy: 0.4, effects: ['lofi'] },
      { role: 'bass', name: 'Bass', preset: 'sub-bass', minEnergy: 0.4 },
      { role: 'chords', name: 'Warm Keys', preset: 'warm-epiano', comp: 'block', minEnergy: 0, effects: ['lofi-keys'] },
      { role: 'melody', name: 'Mellow Lead', preset: 'celesta', minEnergy: 0.5 },
    ],
    drums: 'lofi', bass: 'syncopated', melodyDensity: 0.4, syncopation: 0.5, swing: 0.45, mastering: 'lofi', reverb: 0.6,
  },
  synthwave: {
    id: 'synthwave', label: 'Synthwave', bpm: [84, 112], majorModes: ['major'], minorModes: ['minor', 'dorian'], preferMinor: 0.7, keys: [9, 4, 2, 7],
    timeSig: [4, 4], chordSize: 3, harmonicRhythm: 1,
    progMajor: [P('I V vi IV'), P('IV V I vi')], progMinor: [P('i VI III VII'), P('i VI VII VII'), P('VI VII i i')],
    structure: [
      { kind: 'intro', bars: 8, energy: 0.45 }, { kind: 'verse', bars: 8, energy: 0.6 }, { kind: 'chorus', bars: 8, energy: 0.85 },
      { kind: 'verse', bars: 8, energy: 0.6, optional: true }, { kind: 'chorus', bars: 8, energy: 0.9 }, { kind: 'solo', bars: 8, energy: 0.85, optional: true }, { kind: 'outro', bars: 8, energy: 0.45 },
    ],
    roles: [
      { role: 'drums', name: 'Drum Machine', preset: 'kit-electronic', minEnergy: 0.5, effects: ['gated'] },
      { role: 'bass', name: 'Arp Bass', preset: 'synth-bass', minEnergy: 0 },
      { role: 'pad', name: 'Pad', preset: 'warm-pad', comp: 'pad', minEnergy: 0, effects: ['chorus'] },
      { role: 'melody', name: 'Lead', preset: 'square-lead', minEnergy: 0.55, effects: ['delay'] },
      { role: 'arp', name: 'Arp', preset: 'arp-pluck', comp: 'arp', minEnergy: 0.7 },
    ],
    drums: 'synthwave', bass: 'arp-bass', melodyDensity: 0.5, syncopation: 0.3, swing: 0, mastering: 'electronic', reverb: 0.9,
  },
  dnb: {
    id: 'dnb', label: 'Drum & Bass', bpm: [170, 176], majorModes: ['minor'], minorModes: ['minor', 'dorian'], preferMinor: 0.9, keys: [5, 7, 9, 2],
    timeSig: [4, 4], chordSize: 4, harmonicRhythm: 0.5,
    progMajor: [P('i7 VImaj7 i7 VImaj7')], progMinor: [P('i7 VImaj7 i7 VImaj7'), P('i7 iv7 VI VII')],
    structure: [
      { kind: 'intro', bars: 16, energy: 0.4 }, { kind: 'buildup', bars: 8, energy: 0.7 }, { kind: 'drop', bars: 32, energy: 1 },
      { kind: 'breakdown', bars: 16, energy: 0.4 }, { kind: 'drop', bars: 32, energy: 1 }, { kind: 'outro', bars: 8, energy: 0.4 },
    ],
    roles: [
      { role: 'drums', name: 'Breaks', preset: 'kit-electronic', minEnergy: 0.4, skip: ['breakdown'] },
      { role: 'bass', name: 'Reese', preset: 'reese-bass', minEnergy: 0.65 },
      { role: 'pad', name: 'Atmos', preset: 'dark-pad', comp: 'pad', minEnergy: 0 },
      { role: 'melody', name: 'Lead', preset: 'sine-lead', minEnergy: 0.9 },
    ],
    drums: 'dnb', bass: 'reese', melodyDensity: 0.35, syncopation: 0.4, swing: 0, mastering: 'electronic', reverb: 0.7,
  },
  funk: {
    id: 'funk', label: 'Funk / R&B', bpm: [96, 112], majorModes: ['mixolydian', 'dorian'], minorModes: ['dorian', 'minor'], preferMinor: 0.5, keys: [4, 9, 2, 7],
    timeSig: [4, 4], chordSize: 4, harmonicRhythm: 1,
    progMajor: [P('I7 IV7 I7 IV7'), P('Imaj7 ii7 iii7 IVmaj7')], progMinor: [P('i7 IV7 i7 IV7'), P('i7 i7 IV7 IV7')],
    structure: [
      { kind: 'intro', bars: 4, energy: 0.55 }, { kind: 'verse', bars: 8, energy: 0.7 }, { kind: 'chorus', bars: 8, energy: 0.85 },
      { kind: 'verse', bars: 8, energy: 0.7, optional: true }, { kind: 'chorus', bars: 8, energy: 0.9 }, { kind: 'bridge', bars: 8, energy: 0.65, optional: true }, { kind: 'chorus', bars: 8, energy: 0.95 }, { kind: 'outro', bars: 4, energy: 0.55 },
    ],
    roles: [
      { role: 'drums', name: 'Drums', preset: 'kit-acoustic', minEnergy: 0 },
      { role: 'bass', name: 'Slap Bass (synth)', preset: 'synth-bass', minEnergy: 0 },
      { role: 'chords', name: 'Clav', preset: 'clav', comp: 'stabs', minEnergy: 0 },
      { role: 'brass', name: 'Horn Stabs', preset: 'brass-section', minEnergy: 0.8 },
      { role: 'melody', name: 'Lead', preset: 'square-lead', minEnergy: 0.6 },
    ],
    drums: 'funk', bass: 'syncopated', melodyDensity: 0.55, syncopation: 0.7, swing: 0.2, mastering: 'pop', reverb: 0.4,
  },
  piano: {
    id: 'piano', label: 'Solo Piano / Peaceful', bpm: [66, 88], majorModes: ['major', 'lydian'], minorModes: ['minor'], preferMinor: 0.35, keys: [0, 7, 2, 5, 9, 4],
    timeSig: [4, 4], chordSize: 4, harmonicRhythm: 1,
    progMajor: [P('I V vi IV'), P('IVmaj7 I V vi'), P('I iii IV V'), P('vi IV I V')], progMinor: [P('i VI III VII'), P('i iv VI V')],
    structure: [
      { kind: 'intro', bars: 4, energy: 0.25 }, { kind: 'theme', bars: 8, energy: 0.4 }, { kind: 'theme', bars: 8, energy: 0.5 },
      { kind: 'development', bars: 8, energy: 0.6 }, { kind: 'theme', bars: 8, energy: 0.5, optional: true }, { kind: 'coda', bars: 4, energy: 0.3 },
    ],
    roles: [
      { role: 'melody', name: 'Piano (melody)', preset: 'synth-piano', minEnergy: 0.3, skip: ['intro'] },
      { role: 'chords', name: 'Piano (accompaniment)', preset: 'synth-piano', comp: 'broken', minEnergy: 0, center: 52 },
      { role: 'strings', name: 'Soft Strings', preset: 'string-ensemble', comp: 'pad', minEnergy: 0.45 },
    ],
    drums: 'none', bass: 'sustain', melodyDensity: 0.4, syncopation: 0.15, swing: 0, mastering: 'acoustic', reverb: 1, ritardando: true,
  },
  experimental: {
    id: 'experimental', label: 'Experimental', bpm: [70, 140], majorModes: ['lydian', 'locrian'], minorModes: ['phrygian', 'locrian', 'harmonicMinor'], preferMinor: 0.6, keys: [1, 6, 11, 4],
    timeSig: [7, 8], chordSize: 4, harmonicRhythm: 1,
    progMajor: [P('I bII bVII #IV'), P('Imaj7 bIII bVI bII')], progMinor: [P('i bII v bVI'), P('i #iv° bVII bII')],
    structure: [
      { kind: 'intro', bars: 4, energy: 0.3 }, { kind: 'theme', bars: 8, energy: 0.6 }, { kind: 'development', bars: 8, energy: 0.8 },
      { kind: 'breakdown', bars: 4, energy: 0.3 }, { kind: 'climax', bars: 8, energy: 1 }, { kind: 'outro', bars: 4, energy: 0.3 },
    ],
    roles: [
      { role: 'drums', name: 'Glitch Perc', preset: 'kit-808', minEnergy: 0.5, effects: ['lofi'] },
      { role: 'bass', name: 'Bass', preset: 'reese-bass', minEnergy: 0.4 },
      { role: 'pad', name: 'Texture', preset: 'dark-pad', comp: 'pad', minEnergy: 0 },
      { role: 'arp', name: 'Bells', preset: 'bells', comp: 'arp', minEnergy: 0.5 },
      { role: 'melody', name: 'Lead', preset: 'square-lead', minEnergy: 0.6, effects: ['delay'] },
    ],
    drums: 'halftime', bass: 'sustain', melodyDensity: 0.5, syncopation: 0.7, swing: 0, mastering: 'electronic', reverb: 0.9,
  },
};
GENRES['film score'] = GENRES.orchestral;
GENRES.cinematic = GENRES.orchestral;

export const GENRE_LIST = ['pop', 'rock', 'hiphop', 'edm', 'orchestral', 'classical', 'jazz', 'country', 'metal', 'ambient', 'lofi', 'synthwave', 'trap', 'house', 'dnb', 'funk', 'piano', 'experimental'];

export interface MoodProfile { minor: number; tempo: number; energy: number; modes?: ModeName[]; brightness: number; progBias?: string[][] }
export const MOODS: Record<string, MoodProfile> = {
  heroic: { minor: 0.2, tempo: 0.1, energy: 0.2, modes: ['major', 'mixolydian'], brightness: 0.8, progBias: [P('I bVII IV I'), P('I V vi IV'), P('I bVI bVII I'), P('vi IV I V')] },
  sad: { minor: 0.9, tempo: -0.2, energy: -0.2, modes: ['minor'], brightness: 0.3, progBias: [P('i VI III VII'), P('i iv VI V'), P('VI iv i V')] },
  happy: { minor: 0.05, tempo: 0.12, energy: 0.1, modes: ['major'], brightness: 0.9, progBias: [P('I IV V IV'), P('I V vi IV'), P('I vi IV V')] },
  dark: { minor: 1, tempo: -0.05, energy: 0.05, modes: ['minor', 'phrygian', 'harmonicMinor'], brightness: 0.1, progBias: [P('i bII i VII'), P('i VI iv V'), P('i iv i V')] },
  intense: { minor: 0.8, tempo: 0.15, energy: 0.3, modes: ['minor', 'harmonicMinor'], brightness: 0.4, progBias: [P('i VI VII i'), P('i iv VI V')] },
  peaceful: { minor: 0.15, tempo: -0.25, energy: -0.3, modes: ['major', 'lydian'], brightness: 0.7, progBias: [P('Imaj7 IVmaj7 Imaj7 IVmaj7'), P('I V vi IV'), P('IV I V vi')] },
  motivational: { minor: 0.15, tempo: 0.1, energy: 0.25, modes: ['major'], brightness: 0.8, progBias: [P('vi IV I V'), P('I V vi IV')] },
  mysterious: { minor: 0.85, tempo: -0.1, energy: -0.1, modes: ['dorian', 'harmonicMinor', 'phrygian'], brightness: 0.3, progBias: [P('i bII i bII'), P('i VI i VII')] },
  uplifting: { minor: 0.1, tempo: 0.08, energy: 0.2, modes: ['major', 'lydian'], brightness: 0.85, progBias: [P('IV V vi I'), P('I V vi IV'), P('vi IV I V')] },
  emotional: { minor: 0.6, tempo: -0.1, energy: 0, modes: ['minor', 'major'], brightness: 0.5, progBias: [P('vi IV I V'), P('i VI III VII'), P('I V vi iii IV I IV V')] },
  romantic: { minor: 0.3, tempo: -0.15, energy: -0.1, modes: ['major'], brightness: 0.6, progBias: [P('Imaj7 vi7 ii7 V7')] },
  epic: { minor: 0.6, tempo: 0.05, energy: 0.35, modes: ['minor', 'dorian'], brightness: 0.5, progBias: [P('i VI III VII'), P('VI VII i i')] },
  chill: { minor: 0.4, tempo: -0.2, energy: -0.25, modes: ['dorian', 'major'], brightness: 0.5 },
  energetic: { minor: 0.4, tempo: 0.15, energy: 0.3, brightness: 0.7 },
  neutral: { minor: 0.5, tempo: 0, energy: 0, brightness: 0.5 },
};
export const MOOD_LIST = ['heroic', 'sad', 'happy', 'dark', 'intense', 'peaceful', 'motivational', 'mysterious', 'uplifting', 'emotional', 'romantic', 'epic', 'chill', 'energetic'];

/** Default section energies used when a user specifies structure manually. */
export const SECTION_DEFAULTS: Record<SectionKind, { bars: number; energy: number }> = {
  intro: { bars: 4, energy: 0.35 }, verse: { bars: 8, energy: 0.55 }, prechorus: { bars: 4, energy: 0.7 }, chorus: { bars: 8, energy: 0.88 },
  postchorus: { bars: 4, energy: 0.75 }, bridge: { bars: 8, energy: 0.55 }, breakdown: { bars: 8, energy: 0.35 }, buildup: { bars: 8, energy: 0.75 },
  drop: { bars: 16, energy: 1 }, solo: { bars: 8, energy: 0.85 }, interlude: { bars: 4, energy: 0.45 }, outro: { bars: 4, energy: 0.35 },
  theme: { bars: 8, energy: 0.55 }, development: { bars: 8, energy: 0.7 }, climax: { bars: 8, energy: 1 }, coda: { bars: 4, energy: 0.4 }, custom: { bars: 8, energy: 0.6 },
};

/** Instrument keyword → role/preset mapping for prompt and "Add instrument" parsing. */
export const INSTRUMENT_WORDS: { re: RegExp; role: TrackRole; preset: string; name: string; comp?: CompStyle }[] = [
  { re: /electric piano|e-?piano|rhodes|wurli/i, role: 'chords', preset: 'epiano', name: 'Electric Piano', comp: 'block' },
  { re: /piano|keys/i, role: 'chords', preset: 'synth-piano', name: 'Piano', comp: 'broken' },
  { re: /organ/i, role: 'pad', preset: 'organ-full', name: 'Organ', comp: 'pad' },
  { re: /violins?|fiddle/i, role: 'melody', preset: 'violins', name: 'Violins' },
  { re: /cellos?/i, role: 'countermelody', preset: 'cellos', name: 'Cellos' },
  { re: /contrabass|double bass|upright bass/i, role: 'bass', preset: 'orch-basses', name: 'Basses' },
  { re: /pizzicato|pizz/i, role: 'ostinato', preset: 'pizzicato', name: 'Pizzicato', comp: 'ostinato' },
  { re: /spiccato|staccato strings|ostinato/i, role: 'ostinato', preset: 'spiccato', name: 'Spiccato Strings', comp: 'ostinato' },
  { re: /strings?|orchestra/i, role: 'strings', preset: 'string-ensemble', name: 'Strings', comp: 'pad' },
  { re: /french horns?|horns?/i, role: 'brass', preset: 'french-horns', name: 'French Horns' },
  { re: /trumpets?/i, role: 'brass', preset: 'trumpet', name: 'Trumpet' },
  { re: /trombones?/i, role: 'brass', preset: 'trombone', name: 'Trombones' },
  { re: /brass/i, role: 'brass', preset: 'brass-section', name: 'Brass' },
  { re: /flutes?/i, role: 'woodwinds', preset: 'flute', name: 'Flute' },
  { re: /clarinets?/i, role: 'woodwinds', preset: 'clarinet', name: 'Clarinet' },
  { re: /sax(ophone)?/i, role: 'melody', preset: 'sax', name: 'Saxophone' },
  { re: /woodwinds?/i, role: 'woodwinds', preset: 'flute', name: 'Woodwinds' },
  { re: /choir|choral|voices/i, role: 'pad', preset: 'synth-choir', name: 'Choir', comp: 'pad' },
  { re: /acoustic guitar/i, role: 'chords', preset: 'steel-guitar', name: 'Acoustic Guitar', comp: 'strum' },
  { re: /nylon|classical guitar|spanish guitar/i, role: 'chords', preset: 'nylon-guitar', name: 'Nylon Guitar', comp: 'broken' },
  { re: /electric guitars?|distorted guitar|power chords?|guitars?/i, role: 'chords', preset: 'dist-guitar', name: 'Electric Guitar', comp: 'power' },
  { re: /808/i, role: 'bass', preset: '808-bass', name: '808' },
  { re: /sub ?bass/i, role: 'bass', preset: 'sub-bass', name: 'Sub Bass' },
  { re: /reese/i, role: 'bass', preset: 'reese-bass', name: 'Reese Bass' },
  { re: /bass guitar/i, role: 'bass', preset: 'pick-bass', name: 'Bass Guitar' },
  { re: /\bbass\b/i, role: 'bass', preset: 'synth-bass', name: 'Bass' },
  { re: /supersaw/i, role: 'pad', preset: 'supersaw', name: 'Supersaw', comp: 'stabs' },
  { re: /arp(eggio|eggiator)?s?\b/i, role: 'arp', preset: 'arp-pluck', name: 'Arp', comp: 'arp' },
  { re: /pluck/i, role: 'arp', preset: 'pluck', name: 'Pluck', comp: 'arp' },
  { re: /pads?\b|atmospher/i, role: 'pad', preset: 'warm-pad', name: 'Pad', comp: 'pad' },
  { re: /lead synth|synth lead|\blead\b/i, role: 'melody', preset: 'saw-lead', name: 'Lead Synth' },
  { re: /synth/i, role: 'pad', preset: 'warm-pad', name: 'Synth', comp: 'pad' },
  { re: /bells?|glockenspiel|celesta|music box/i, role: 'arp', preset: 'celesta', name: 'Bells', comp: 'arp' },
  { re: /harp/i, role: 'arp', preset: 'harp', name: 'Harp', comp: 'arp' },
  { re: /marimba|vibraphone|mallets?/i, role: 'arp', preset: 'marimba', name: 'Marimba', comp: 'arp' },
  { re: /timpani/i, role: 'fx', preset: 'timpani', name: 'Timpani' },
  { re: /taiko|cinematic (drums|percussion)|epic drums|war drums/i, role: 'percussion', preset: 'kit-orchestral', name: 'Cinematic Percussion' },
  { re: /drums?|beat|percussion/i, role: 'drums', preset: 'kit-electronic', name: 'Drums' },
  { re: /rain|storm/i, role: 'fx', preset: 'rain-ambience', name: 'Rain Ambience' },
];
