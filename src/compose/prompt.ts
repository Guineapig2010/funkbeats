/**
 * Natural-language prompt understanding for the local composer.
 * Extracts genre, mood, tempo, key, duration, instruments, structure, energy and
 * production hints from free text. Explicit UI settings override prompt guesses.
 */
import type { GenerationSettings, SectionKind, TrackRole } from '../model/schema';
import { parseKey } from '../theory/theory';
import { GENRES, INSTRUMENT_WORDS, MOODS } from './styles';

export interface Brief {
  genre: string;
  mood: string;
  bpm: number | null;
  key: { tonic: number; mode: import('../model/schema').ModeName } | null;
  durationSec: number;
  instruments: { role: TrackRole; preset: string; name: string; comp?: string }[];
  excludeRoles: TrackRole[];
  structure: SectionKind[] | null;
  energy: number;
  complexity: number;
  creativity: number;
  vocals: GenerationSettings['vocals'];
  vocalVoice: 'any' | 'male' | 'female' | 'choir';
  wantsClimax: boolean;
  wantsAmbience: string | null;
  soft: boolean;
  timeSig: [number, 4 | 8] | null;
  notes: string[];
  explicitInstrumentation: boolean;
}

const GENRE_WORDS: [RegExp, string][] = [
  [/film score|soundtrack|cinematic|movie|trailer|epic orchestral/i, 'orchestral'],
  [/orchestra(l)?|symphon/i, 'orchestral'],
  [/classical|baroque|sonata|chamber/i, 'classical'],
  [/lo-?fi|chillhop|study beats/i, 'lofi'],
  [/synth ?wave|retrowave|outrun|80s/i, 'synthwave'],
  [/drum (and|&|n) bass|dnb|jungle/i, 'dnb'],
  [/trap ?funk|funk (brasileiro|mandel|bh|150|automotivo)|mandel[aã]o|brazilian trap/i, 'brfunk'],
  [/plugg|pluggnb|baile|funk carioca|brazilian funk|tamborz/i, 'pluggnb'],
  [/trap/i, 'trap'],
  [/hip-?hop|rap|boom ?bap/i, 'hiphop'],
  [/deep house|house music|\bhouse\b/i, 'house'],
  [/edm|dance|electro|techno|trance|dubstep|club|festival/i, 'edm'],
  [/metal|metalcore|thrash|djent/i, 'metal'],
  [/rock|punk|grunge|anthem/i, 'rock'],
  [/jazz|swing|bebop|bossa/i, 'jazz'],
  [/country|bluegrass|folk|americana/i, 'country'],
  [/funk|r&b|rnb|soul|disco|groove/i, 'funk'],
  [/ambient|drone|meditat|soundscape|atmospheric/i, 'ambient'],
  [/experimental|avant|glitch|weird/i, 'experimental'],
  [/peaceful piano|solo piano|piano piece|piano music|piano ballad/i, 'piano'],
  [/\bpop\b|ballad|radio/i, 'pop'],
];

const MOOD_WORDS: [RegExp, string][] = [
  [/heroic|triumphant|victor|brave|hero/i, 'heroic'],
  [/epic|massive|huge|grand|colossal/i, 'epic'],
  [/sad|melanchol|grief|lonely|tragic|sorrow|tears/i, 'sad'],
  [/happy|joyful|cheerful|fun|playful|bright/i, 'happy'],
  [/dark|sinister|evil|horror|menacing|ominous/i, 'dark'],
  [/intense|aggressive|furious|angry|powerful|explosive|driving/i, 'intense'],
  [/peaceful|calm|serene|relax|gentle|soothing|tranquil|soft/i, 'peaceful'],
  [/motivat|inspir|determined|workout/i, 'motivational'],
  [/myster|suspense|enigmatic|eerie|tension/i, 'mysterious'],
  [/uplift|hopeful|euphori|soaring/i, 'uplifting'],
  [/emotional|moving|heartfelt|touching|bittersweet|nostalgi/i, 'emotional'],
  [/romantic|love/i, 'romantic'],
  [/chill|laid.?back|mellow|cozy/i, 'chill'],
  [/energetic|upbeat|hype|catchy/i, 'energetic'],
];

const STRUCT_WORDS: [RegExp, SectionKind][] = [
  [/^intro/, 'intro'], [/^verse/, 'verse'], [/^pre.?chorus/, 'prechorus'], [/^(chorus|hook|refrain)/, 'chorus'], [/^post.?chorus/, 'postchorus'],
  [/^bridge/, 'bridge'], [/^break.?down/, 'breakdown'], [/^(build.?up|build|riser)/, 'buildup'], [/^drop/, 'drop'], [/^solo/, 'solo'],
  [/^interlude/, 'interlude'], [/^(outro|ending)/, 'outro'], [/^(final chorus|last chorus)/, 'chorus'], [/^theme/, 'theme'], [/^development/, 'development'],
  [/^climax/, 'climax'], [/^coda/, 'coda'],
];

export function parseStructure(s: string): SectionKind[] | null {
  const parts = s.split(/,|→|->|\||\n|\s+-\s+|>/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const out: SectionKind[] = [];
  for (const p of parts) {
    const hit = STRUCT_WORDS.find(([re]) => re.test(p));
    if (hit) out.push(hit[1]);
  }
  return out.length >= 2 ? out : null;
}

function parseDuration(text: string): number | null {
  const t = text.toLowerCase();
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5, a: 1 };
  let m = /(\d+(?:\.\d+)?)\s*[- ]?\s*(minutes?|mins?|m\b)/.exec(t);
  let total = 0;
  if (m) total += parseFloat(m[1]) * 60;
  else if ((m = /\b(one|two|three|four|five|six|a)\s*[- ]?\s*minutes?/.exec(t))) total += words[m[1]] * 60;
  else if (/half a minute/.test(t)) total += 30;
  const s = /(\d+)\s*(seconds?|secs?|s\b)/.exec(t);
  if (s) total += parseInt(s[1], 10);
  const mmss = /\b(\d{1,2}):(\d{2})\b/.exec(t);
  if (!total && mmss) total = parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10);
  return total > 0 ? total : null;
}

export function parsePrompt(text: string, s?: Partial<GenerationSettings>): Brief {
  const t = text || '';
  const notes: string[] = [];
  // genre
  let genre = s?.genre && s.genre !== 'auto' && s.genre !== 'custom' ? s.genre.toLowerCase() : '';
  if (genre && !GENRES[genre]) {
    const hit = GENRE_WORDS.find(([re]) => re.test(genre));
    genre = hit ? hit[1] : '';
  }
  if (!genre) genre = GENRE_WORDS.find(([re]) => re.test(t))?.[1] ?? '';
  if (!genre) {
    if (/piano/i.test(t) && !/drum|bass|beat/i.test(t)) genre = 'piano';
    else if (/strings|brass|orchestr/i.test(t)) genre = 'orchestral';
    else genre = 'pop';
    notes.push(`No genre given – using ${GENRES[genre].label}.`);
  }
  // mood
  let mood = s?.mood && s.mood !== 'auto' && s.mood !== 'custom' ? s.mood.toLowerCase() : '';
  if (mood && !MOODS[mood]) mood = MOOD_WORDS.find(([re]) => re.test(mood))?.[1] ?? '';
  if (!mood) mood = MOOD_WORDS.find(([re]) => re.test(t))?.[1] ?? 'neutral';
  // tempo
  let bpm: number | null = s?.bpm && s.bpm > 0 ? s.bpm : null;
  const bm = /(\d{2,3})\s*(bpm|beats per minute)/i.exec(t);
  if (!bpm && bm) bpm = Math.max(40, Math.min(220, parseInt(bm[1], 10)));
  if (!bpm) {
    if (/\b(very )?slow\b|largo|adagio/i.test(t)) bpm = -1;
    else if (/\b(very )?fast\b|uptempo|allegro|presto/i.test(t)) bpm = -2;
  }
  // key
  let key = s?.key && s.key !== 'auto' ? parseKey(s.key) : null;
  if (!key) {
    const km = /\bin\s+([A-G][#b]?\s*(major|minor|maj|min|dorian|phrygian|lydian|mixolydian|harmonic minor|m)\b)/i.exec(t)
      ?? /\bkey of\s+([A-G][#b]?\s*(major|minor|maj|min|m)?)/i.exec(t);
    if (km) key = parseKey(km[1]);
  }
  // duration
  const durationSec = s?.durationSec && s.durationSec > 0 && !parseDuration(t) ? s.durationSec : (parseDuration(t) ?? s?.durationSec ?? 120);
  // instruments
  const instruments: Brief['instruments'] = [];
  const instText = [t, s?.instrumentation && s.instrumentation !== 'auto' ? s.instrumentation : ''].join(' ');
  const consumed: [number, number][] = [];
  for (const w of INSTRUMENT_WORDS) {
    const re = new RegExp(w.re.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(instText))) {
      const a = m.index, b = m.index + m[0].length;
      if (consumed.some(([x, y]) => a < y && b > x)) continue;
      // skip negated mentions: "no drums", "without vocals"
      const before = instText.slice(Math.max(0, a - 12), a).toLowerCase();
      consumed.push([a, b]);
      if (/\b(no|without|minus)\s+$/.test(before)) continue;
      if (!instruments.some((i) => i.preset === w.preset)) instruments.push({ role: w.role, preset: w.preset, name: w.name, comp: w.comp });
    }
  }
  const excludeRoles: TrackRole[] = [];
  if (/\b(no|without)\s+(drums|percussion|beat)/i.test(t)) excludeRoles.push('drums', 'percussion');
  if (/\b(no|without)\s+bass/i.test(t)) excludeRoles.push('bass');
  if (/\b(no|without)\s+(melody|lead)/i.test(t)) excludeRoles.push('melody');
  // structure
  const structure = (s?.structure && s.structure !== 'auto' ? parseStructure(s.structure) : null) ?? (/(→|->)/.test(t) ? parseStructure(t) : null);
  // energy & dynamics
  let energy = s?.energy ?? 0.6;
  if (/explosive|massive|powerful|huge|intense|aggressive|banger|hard[- ]hitting/i.test(t)) energy = Math.max(energy, 0.85);
  if (/gentle|soft|quiet|calm|delicate|peaceful|minimal/i.test(t)) energy = Math.min(energy, 0.4);
  const soft = /gentle|soft|quiet|calm|delicate|peaceful/i.test(t);
  // vocals
  let vocals: GenerationSettings['vocals'] = s?.vocals ?? 'none';
  if (vocals === 'none' && /vocal|singer|singing|sung|lyrics|rap verse|choir vocals/i.test(t) && !/no vocals|instrumental/i.test(t)) vocals = 'recorded';
  const vocalVoice = /female|woman|girl|soprano|alto/i.test(t) ? 'female' : /male|man|boy|tenor|baritone|bass voice/i.test(t) ? 'male' : /choir/i.test(t) && vocals !== 'none' ? 'choir' : 'any';
  const wantsClimax = /climax|finale|massive (ending|finish)|big ending|explosive chorus|crescendo/i.test(t);
  const wantsAmbience = /rain|storm/i.test(t) ? 'rain' : null;
  let timeSig: Brief['timeSig'] = null;
  const ts = /\b(\d{1,2})\/(4|8)\b/.exec(t);
  if (ts) timeSig = [parseInt(ts[1], 10), parseInt(ts[2], 10) as 4 | 8];
  else if (/waltz/i.test(t)) timeSig = [3, 4];
  return {
    genre, mood, bpm, key, durationSec: Math.max(10, Math.min(1200, durationSec)), instruments, excludeRoles, structure,
    energy, complexity: s?.complexity ?? 0.5, creativity: s?.creativity ?? 0.5, vocals, vocalVoice, wantsClimax, wantsAmbience, soft, timeSig, notes,
    explicitInstrumentation: !!s?.instrumentation && s.instrumentation !== 'auto' && s.instrumentation.trim().length > 0,
  };
}
