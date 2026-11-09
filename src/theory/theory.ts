/** Music theory primitives: pitch classes, scales/modes, chords, symbols, voice leading. */
import type { ModeName } from '../model/schema';

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export const SCALES: Record<ModeName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const MODE_LABELS: Record<ModeName, string> = {
  major: 'Major (Ionian)', minor: 'Minor (Aeolian)', harmonicMinor: 'Harmonic Minor', melodicMinor: 'Melodic Minor',
  dorian: 'Dorian', phrygian: 'Phrygian', lydian: 'Lydian', mixolydian: 'Mixolydian', locrian: 'Locrian',
  pentatonicMajor: 'Major Pentatonic', pentatonicMinor: 'Minor Pentatonic', blues: 'Blues', chromatic: 'Chromatic',
};

/** Heptatonic parent used for harmony when the melodic mode is pentatonic/blues/chromatic. */
export function harmonicParent(mode: ModeName): ModeName {
  if (mode === 'pentatonicMajor') return 'major';
  if (mode === 'pentatonicMinor' || mode === 'blues') return 'minor';
  if (mode === 'chromatic') return 'major';
  return mode;
}

export function isMinorish(mode: ModeName) {
  const s = SCALES[harmonicParent(mode)];
  return s[2] === 3;
}

export const pc = (n: number) => ((n % 12) + 12) % 12;
export const noteName = (midi: number, flats = false) => `${(flats ? FLAT_NAMES : NOTE_NAMES)[pc(midi)]}${Math.floor(midi / 12) - 1}`;

export function parseNoteName(s: string): number | null {
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d+)?$/.exec(s.trim());
  if (!m) return null;
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase() as 'c'];
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  if (m[3] === undefined) return pc(base + acc);
  return (parseInt(m[3], 10) + 1) * 12 + base + acc;
}

export function parsePitchClass(s: string): number | null {
  const m = /^\s*([A-Ga-g])([#b♯♭]?)/.exec(s);
  if (!m) return null;
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase() as 'c'];
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return pc(base + acc);
}

export function scalePitchClasses(tonic: number, mode: ModeName): number[] {
  return SCALES[mode].map((i) => pc(tonic + i));
}

export function inScale(midi: number, tonic: number, mode: ModeName) {
  return SCALES[mode].includes(pc(midi - tonic));
}

/** Snap a pitch to the nearest scale tone (ties resolve downward unless preferUp). */
export function snapToScale(midi: number, tonic: number, mode: ModeName, preferUp = false): number {
  if (inScale(midi, tonic, mode)) return midi;
  for (let d = 1; d < 12; d++) {
    const a = preferUp ? midi + d : midi - d;
    const b = preferUp ? midi - d : midi + d;
    if (inScale(a, tonic, mode)) return a;
    if (inScale(b, tonic, mode)) return b;
  }
  return midi;
}

/** Move by `steps` scale degrees from a (scale) pitch. */
export function scaleStep(midi: number, steps: number, tonic: number, mode: ModeName): number {
  let m = snapToScale(midi, tonic, mode);
  const dir = Math.sign(steps);
  let left = Math.abs(steps);
  while (left > 0) {
    m += dir;
    if (inScale(m, tonic, mode)) left--;
  }
  return m;
}

/** Scale degree index (0-based) of pitch, or -1. */
export function degreeOf(midi: number, tonic: number, mode: ModeName) {
  return SCALES[mode].indexOf(pc(midi - tonic));
}

// ---------- Chords ----------

export const CHORD_QUALITIES: Record<string, { intervals: number[]; suffix: string }> = {
  maj: { intervals: [0, 4, 7], suffix: '' },
  min: { intervals: [0, 3, 7], suffix: 'm' },
  dim: { intervals: [0, 3, 6], suffix: 'dim' },
  aug: { intervals: [0, 4, 8], suffix: 'aug' },
  sus2: { intervals: [0, 2, 7], suffix: 'sus2' },
  sus4: { intervals: [0, 5, 7], suffix: 'sus4' },
  '5': { intervals: [0, 7], suffix: '5' },
  maj7: { intervals: [0, 4, 7, 11], suffix: 'maj7' },
  min7: { intervals: [0, 3, 7, 10], suffix: 'm7' },
  dom7: { intervals: [0, 4, 7, 10], suffix: '7' },
  m7b5: { intervals: [0, 3, 6, 10], suffix: 'm7b5' },
  dim7: { intervals: [0, 3, 6, 9], suffix: 'dim7' },
  add9: { intervals: [0, 4, 7, 14], suffix: 'add9' },
  madd9: { intervals: [0, 3, 7, 14], suffix: 'madd9' },
  maj9: { intervals: [0, 4, 7, 11, 14], suffix: 'maj9' },
  min9: { intervals: [0, 3, 7, 10, 14], suffix: 'm9' },
  dom9: { intervals: [0, 4, 7, 10, 14], suffix: '9' },
  min11: { intervals: [0, 3, 7, 10, 14, 17], suffix: 'm11' },
  dom13: { intervals: [0, 4, 7, 10, 14, 21], suffix: '13' },
  '6': { intervals: [0, 4, 7, 9], suffix: '6' },
  m6: { intervals: [0, 3, 7, 9], suffix: 'm6' },
  '7sus4': { intervals: [0, 5, 7, 10], suffix: '7sus4' },
  mmaj7: { intervals: [0, 3, 7, 11], suffix: 'mMaj7' },
};

const SUFFIX_TO_QUALITY: [string, string][] = Object.entries(CHORD_QUALITIES)
  .map(([q, v]) => [v.suffix, q] as [string, string])
  .concat([['M7', 'maj7'], ['Maj7', 'maj7'], ['min', 'min'], ['-', 'min'], ['-7', 'min7'], ['min7', 'min7'], ['ø', 'm7b5'], ['°', 'dim'], ['o', 'dim'], ['sus', 'sus4'], ['+', 'aug'], ['maj', 'maj'], ['M', 'maj'], ['add2', 'add9'], ['M9', 'maj9'], ['mmaj7', 'mmaj7']])
  .sort((a, b) => b[0].length - a[0].length);

export interface ChordSpec { root: number; quality: string; bass: number | null }

export function chordSymbol(c: ChordSpec, flats = false): string {
  const names = flats ? FLAT_NAMES : NOTE_NAMES;
  const q = CHORD_QUALITIES[c.quality] ?? CHORD_QUALITIES.maj;
  return `${names[c.root]}${q.suffix}${c.bass !== null && c.bass !== c.root ? '/' + names[c.bass] : ''}`;
}

export function parseChordSymbol(sym: string): ChordSpec | null {
  const m = /^\s*([A-Ga-g][#b♯♭]?)(.*?)(?:\/([A-Ga-g][#b♯♭]?))?\s*$/.exec(sym);
  if (!m) return null;
  const root = parsePitchClass(m[1]);
  if (root === null) return null;
  const rest = m[2].trim();
  let quality = 'maj';
  if (rest.length) {
    const hit = SUFFIX_TO_QUALITY.find(([suf]) => suf === rest);
    if (!hit) {
      // tolerate unknown extensions: fall back to minor/major triad by first char
      quality = rest.startsWith('m') && !rest.startsWith('maj') ? 'min' : 'maj';
    } else quality = hit[1];
  }
  const bass = m[3] ? parsePitchClass(m[3]) : null;
  return { root, quality, bass };
}

export function chordPitchClasses(c: ChordSpec): number[] {
  return (CHORD_QUALITIES[c.quality] ?? CHORD_QUALITIES.maj).intervals.map((i) => pc(c.root + i));
}

/** Diatonic triad/seventh on a scale degree (0-based) of a mode. */
export function diatonicChord(tonic: number, mode: ModeName, degree: number, size: 3 | 4 | 5 = 3): ChordSpec {
  const parent = harmonicParent(mode);
  const s = SCALES[parent];
  const d = ((degree % 7) + 7) % 7;
  const tones = [0, 2, 4, 6, 8].slice(0, size).map((k) => {
    const idx = d + k;
    return s[idx % 7] + 12 * Math.floor(idx / 7);
  });
  const rel = tones.map((t) => t - tones[0]);
  const third = rel[1], fifth = rel[2], seventh = rel[3], ninth = rel[4];
  let quality = 'maj';
  if (third === 4 && fifth === 7) quality = 'maj';
  else if (third === 3 && fifth === 7) quality = 'min';
  else if (third === 3 && fifth === 6) quality = 'dim';
  else if (third === 4 && fifth === 8) quality = 'aug';
  if (size >= 4) {
    if (quality === 'maj') quality = seventh === 11 ? 'maj7' : 'dom7';
    else if (quality === 'min') quality = seventh === 10 ? 'min7' : 'mmaj7';
    else if (quality === 'dim') quality = seventh === 10 ? 'm7b5' : 'dim7';
  }
  if (size === 5 && ninth === 14) {
    if (quality === 'maj7') quality = 'maj9';
    else if (quality === 'min7') quality = 'min9';
    else if (quality === 'dom7') quality = 'dom9';
  }
  return { root: pc(tonic + s[d]), quality, bass: null };
}

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];
/**
 * Parse a roman-numeral token relative to key, e.g. "I", "vi", "bVII", "V7", "ii7", "IVmaj7", "V/V", "sus4:V".
 * Case of the numeral is treated as a hint; diatonic quality wins unless it is a borrowed (b/#) chord.
 */
export function romanToChord(token: string, tonic: number, mode: ModeName): ChordSpec {
  let t = token.trim();
  let forceQuality: string | null = null;
  const colon = t.indexOf(':');
  if (colon > 0) {
    forceQuality = t.slice(0, colon);
    t = t.slice(colon + 1);
  }
  // secondary dominant V/x
  const slash = t.indexOf('/');
  if (slash > 0 && /^V7?$/.test(t.slice(0, slash))) {
    const target = romanToChord(t.slice(slash + 1), tonic, mode);
    return { root: pc(target.root + 7), quality: t.includes('7') ? 'dom7' : 'maj', bass: null };
  }
  const m = /^([b#]?)([ivIV]+)(.*)$/.exec(t);
  if (!m) return diatonicChord(tonic, mode, 0);
  const acc = m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0;
  const numeral = m[2];
  const deg = ROMAN.indexOf(numeral.toLowerCase());
  const ext = m[3];
  if (deg < 0) return diatonicChord(tonic, mode, 0);
  const upper = numeral === numeral.toUpperCase();
  let chord: ChordSpec;
  if (acc !== 0) {
    // borrowed: compute root from major scale degree
    const root = pc(tonic + SCALES.major[deg] + acc);
    chord = { root, quality: upper ? 'maj' : 'min', bass: null };
  } else {
    const size = /9/.test(ext) ? 5 : /7/.test(ext) ? 4 : 3;
    chord = diatonicChord(tonic, mode, deg, size as 3 | 4 | 5);
    // case mismatch => modal mixture / harmonic-minor V
    const isMinorQ = chord.quality.startsWith('min') || chord.quality === 'm7b5' || chord.quality === 'dim';
    if (upper && isMinorQ && chord.quality !== 'dim') chord.quality = size >= 4 ? 'dom7' : 'maj';
    if (!upper && !isMinorQ) chord.quality = size >= 4 ? 'min7' : 'min';
  }
  if (ext) {
    const e = ext.replace(/^\(|\)$/g, '');
    if (e === 'sus4' || e === 'sus2' || e === 'add9' || e === '7sus4' || e === '6') chord.quality = e;
    else if (e === 'maj7') chord.quality = 'maj7';
    else if (e === 'maj9') chord.quality = 'maj9';
    else if (e === '°' || e === 'o' || e === 'dim') chord.quality = 'dim';
    else if (e === 'ø' || e === 'ø7' || e === 'm7b5') chord.quality = 'm7b5';
    else if (e === '°7' || e === 'dim7') chord.quality = 'dim7';
    else if (e === '7') chord.quality = upper ? 'dom7' : chord.quality === 'm7b5' || chord.quality === 'dim' ? 'm7b5' : 'min7';
    else if (e === '9') chord.quality = upper ? (chord.quality === 'maj9' ? 'maj9' : 'dom9') : 'min9';
  }
  if (forceQuality && CHORD_QUALITIES[forceQuality]) chord.quality = forceQuality;
  return chord;
}

/** Choose a voicing for chord near `center` (midi) minimizing movement from previous voicing. */
export function voiceChord(c: ChordSpec, prev: number[] | null, center = 60, voices = 4, spreadLimit = 14): number[] {
  const pcs = chordPitchClasses(c);
  const want = voices;
  // candidate generation: try each inversion/rotation in octaves around center
  const candidates: number[][] = [];
  const tones = [...pcs];
  while (tones.length < want) tones.push(tones[tones.length % pcs.length]);
  const base = tones.slice(0, Math.max(want, pcs.length > want ? want : pcs.length));
  for (let rot = 0; rot < base.length; rot++) {
    const order = base.slice(rot).concat(base.slice(0, rot));
    for (let oct = -2; oct <= 2; oct++) {
      const out: number[] = [];
      let cur = Math.floor(center / 12) * 12 + oct * 12 + order[0] - 12;
      for (const p of order) {
        let n = Math.floor(cur / 12) * 12 + p;
        while (n <= (out.length ? out[out.length - 1] : cur - 1)) n += 12;
        out.push(n);
        cur = n;
      }
      if (out[out.length - 1] - out[0] <= spreadLimit + 12) candidates.push(out.slice(0, want));
    }
  }
  let best = candidates[0] ?? pcs.map((p) => 60 + p);
  let bestScore = Infinity;
  for (const cand of candidates) {
    const mean = cand.reduce((a, b) => a + b, 0) / cand.length;
    let score = Math.abs(mean - center) * 0.6;
    if (prev && prev.length) {
      const k = Math.min(prev.length, cand.length);
      for (let i = 0; i < k; i++) score += Math.abs(cand[i] - prev[i]);
    }
    // keep root/third present
    if (!cand.some((n) => pc(n) === c.root)) score += 6;
    if (score < bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

export function bassNoteFor(c: ChordSpec, center = 40): number {
  const p = c.bass ?? c.root;
  let n = Math.floor(center / 12) * 12 + p;
  if (n - center > 6) n -= 12;
  if (center - n > 6) n += 12;
  return n;
}

/** Conventional key names (flats for Db/Eb/Ab/Bb, F# for the tritone). */
export const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export function keyLabel(tonic: number, mode: ModeName) {
  return `${KEY_NAMES[tonic]} ${MODE_LABELS[mode]}`;
}

export function parseKey(s: string): { tonic: number; mode: ModeName } | null {
  const tonic = parsePitchClass(s);
  if (tonic === null) return null;
  const low = s.toLowerCase();
  const modes: [RegExp, ModeName][] = [
    [/harmonic/, 'harmonicMinor'], [/melodic/, 'melodicMinor'], [/dorian/, 'dorian'], [/phrygian/, 'phrygian'],
    [/lydian/, 'lydian'], [/mixolydian/, 'mixolydian'], [/locrian/, 'locrian'], [/blues/, 'blues'],
    [/minor|\bmin\b|^[a-g][#b]?m\b/, 'minor'], [/major|\bmaj\b/, 'major'],
  ];
  for (const [re, m] of modes) if (re.test(low)) return { tonic, mode: m };
  return { tonic, mode: 'major' };
}
