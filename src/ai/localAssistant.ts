/**
 * Local (offline) assistant: a keyword/pattern interpreter that maps requests onto
 * the same validated commands Claude uses. It is clearly labelled in the UI and only
 * claims what it can actually do.
 */
import type { Project } from '../model/schema';
import type { Command } from './commands';
import { GENRES, INSTRUMENT_WORDS } from '../compose/styles';
import { PRESETS } from '../model/presets';
import { parseKey } from '../theory/theory';

export interface LocalReply { reply: string; commands: Command[] }

const SECTION_WORDS = /\b(intro|verse|pre-?chorus|chorus|hook|bridge|breakdown|build-?up|drop|solo|interlude|outro|ending|theme|development|climax|coda)(\s*\d+)?\b/i;

type RangeSpec = { section?: string; selection?: boolean; from_bar?: number; to_bar?: number } | undefined;

function findRange(text: string, p: Project, hasSelection: boolean): RangeSpec {
  if (hasSelection && /\b(this|these|selected|selection|here|region)\b/i.test(text)) return { selection: true };
  const bars = /\bbars?\s+(\d+)\s*(?:-|to|–|through)\s*(\d+)/i.exec(text);
  if (bars) return { from_bar: parseInt(bars[1], 10), to_bar: parseInt(bars[2], 10) };
  const m = SECTION_WORDS.exec(text);
  if (m) {
    let w = m[1].toLowerCase().replace('-', '');
    if (w === 'hook') w = 'chorus';
    if (w === 'ending') w = 'outro';
    if (w === 'buildup') w = 'buildup';
    const named = p.sections.find((s) => s.name.toLowerCase() === `${w}${m[2] ? ' ' + m[2].trim() : ''}`.toLowerCase());
    if (named) return { section: named.name };
    if (/final|last/i.test(text)) {
      const last = [...p.sections].reverse().find((s) => s.kind === w);
      if (last) return { section: last.name };
    }
    if (p.sections.some((s) => s.kind === w)) return { section: w };
  }
  if (hasSelection) return { selection: true };
  return undefined;
}

function findInstrument(text: string): { word: string; preset: string } | null {
  for (const w of INSTRUMENT_WORDS) {
    const m = w.re.exec(text);
    if (m) return { word: m[0], preset: w.preset };
  }
  return null;
}

export function localAssistant(text: string, p: Project, hasSelection: boolean): LocalReply {
  const t = text.trim();
  const low = t.toLowerCase();
  const commands: Command[] = [];
  const notes: string[] = [];
  const range = findRange(t, p, hasSelection);
  const inst = findInstrument(t);
  const trackFor = (word: string) => p.tracks.find((x) => x.name.toLowerCase().includes(word.toLowerCase()))?.name ?? word;

  // tempo
  const bpm = /(\d{2,3})\s*bpm/i.exec(t) ?? /tempo (?:to |of )?(\d{2,3})/i.exec(t);
  if (bpm) commands.push({ op: 'set_tempo', bpm: parseInt(bpm[1], 10) });
  else if (/\b(faster|speed (it )?up|quicker)\b/i.test(t)) commands.push({ op: 'set_tempo', bpm: Math.round(p.bpm * 1.1) });
  else if (/\b(slower|slow (it )?down)\b/i.test(t)) commands.push({ op: 'set_tempo', bpm: Math.round(p.bpm * 0.9) });

  // key
  const key = /\b(?:in|to) (?:the key of )?([A-G][#b]?\s*(?:major|minor|maj|min|dorian|mixolydian|lydian|phrygian))\b/i.exec(t);
  if (key && parseKey(key[1])) commands.push({ op: 'set_key', key: key[1], transpose_notes: true });
  const tr = /transpose (up|down)?\s*(?:by )?(\d+)/i.exec(t);
  if (tr) commands.push({ op: 'transpose', semitones: parseInt(tr[2], 10) * (tr[1] === 'down' ? -1 : 1), range });

  // genre change / remix
  const genre = Object.keys(GENRES).find((g) => new RegExp(`\\b(make it|turn (it )?into|as an?|change (the )?genre to|convert to)\\s+(a\\s+)?${g}\\b`, 'i').test(t));
  if (genre) commands.push({ op: 'change_genre', genre });
  if (/\bremix\b/i.test(t)) commands.push({ op: 'remix' });

  // movie / cinematic
  if (/movie|film|cinematic|soundtrack|epic|orchestral feel/i.test(t) && !genre) commands.push({ op: 'make_cinematic' });

  // "X is too weak / quiet / loud"
  const weak = /(\w[\w ]*?)\s+(?:is|sounds|feels)\s+(?:too |a bit |way )?(weak|thin|quiet|soft|low|buried|loud|harsh|muddy|boomy|dull|dry|wet)/i.exec(t);
  if (weak) {
    const target = trackFor(inst?.word ?? weak[1].replace(/^the\s+/i, ''));
    const w = weak[2].toLowerCase();
    if (['weak', 'thin', 'quiet', 'low', 'buried'].includes(w)) {
      commands.push({ op: 'adjust_volume', track: target, delta_db: 3 });
      if (/bass|kick|808/i.test(target + weak[1])) {
        commands.push({ op: 'add_effect', target, type: 'eq', params: { lowFreq: 80, lowGain: 4, mid1Freq: 300, mid1Gain: -2 } });
        commands.push({ op: 'add_effect', target, type: 'saturation', params: { drive: 5, warmth: 0.5, mix: 0.7 } });
        notes.push('boosted the low end and added harmonic saturation so the bass reads on small speakers');
      }
    } else if (w === 'soft') commands.push({ op: 'adjust_volume', track: target, delta_db: 3 });
    else if (w === 'loud') commands.push({ op: 'adjust_volume', track: target, delta_db: -3 });
    else if (w === 'harsh') commands.push({ op: 'add_effect', target, type: 'eq', params: { mid2Freq: 3500, mid2Gain: -3, highGain: -2 } });
    else if (w === 'muddy' || w === 'boomy') commands.push({ op: 'add_effect', target, type: 'eq', params: { hpf: 80, mid1Freq: 300, mid1Gain: -4 } });
    else if (w === 'dull') commands.push({ op: 'add_effect', target, type: 'eq', params: { highFreq: 8000, highGain: 4 } });
    else if (w === 'dry') commands.push({ op: 'set_send', track: target, bus: 'reverb', level: 0.4 });
    else if (w === 'wet') commands.push({ op: 'set_send', track: target, bus: 'reverb', level: 0.08 });
  } else if (inst && /\b(louder|turn up|boost|more)\b/i.test(t) && !/\badd\b/i.test(t)) {
    commands.push({ op: 'adjust_volume', track: trackFor(inst.word), delta_db: 3 });
  } else if (inst && /\b(quieter|turn down|lower|less)\b/i.test(t)) {
    commands.push({ op: 'adjust_volume', track: trackFor(inst.word), delta_db: -3 });
  }

  // reverb / delay
  if (/more reverb|wetter|more space|bigger room/i.test(t)) commands.push({ op: 'set_effect_param', target: 'Reverb', type: 'reverb', param: 'decay', value: 4 }, ...p.tracks.map((x) => ({ op: 'set_send' as const, track: x.name, bus: 'reverb' as const, level: Math.min(1, (x.sends.find((s) => s.returnId === 'ret-reverb')?.level ?? 0.1) + 0.12) })));
  if (/less reverb|drier|dry it up/i.test(t)) commands.push(...p.tracks.map((x) => ({ op: 'set_send' as const, track: x.name, bus: 'reverb' as const, level: Math.max(0, (x.sends.find((s) => s.returnId === 'ret-reverb')?.level ?? 0) * 0.5) })));

  // add / remove / replace instruments
  const replace = /(?:replace|swap|change) (?:the )?([\w ]+?) (?:with|for|to) (?:an? )?([\w ]+)/i.exec(t);
  if (replace) {
    const to = INSTRUMENT_WORDS.find((w) => w.re.test(replace[2]));
    const preset = to?.preset ?? PRESETS.find((x) => x.name.toLowerCase().includes(replace[2].toLowerCase()))?.id;
    if (preset) commands.push({ op: 'set_instrument', track: trackFor(replace[1]), preset });
  } else if (/\b(add|bring in|include|layer)\b/i.test(t)) {
    // possibly several instruments: "add strings and a choir"
    const added = new Set<string>();
    for (const w of INSTRUMENT_WORDS) {
      const m = w.re.exec(t);
      if (m && !added.has(w.preset)) {
        if (/rising string|string section/i.test(t) && w.preset !== 'string-ensemble' && w.role === 'strings') continue;
        added.add(w.preset);
        if (!p.tracks.some((x) => x.instrument.preset === w.preset)) commands.push({ op: 'add_track', instrument: m[0] });
      }
    }
  }
  if (/\b(remove|delete|get rid of|drop the|no more)\b/i.test(t) && inst) commands.push({ op: 'remove_track', track: trackFor(inst.word) });
  if (/\bmute\b/i.test(t) && inst) commands.push({ op: 'set_track', track: trackFor(inst.word), mute: true });
  if (/\bunmute\b/i.test(t) && inst) commands.push({ op: 'set_track', track: trackFor(inst.word), mute: false });

  // musical regeneration
  if (/(different|new|another|better|improve|rewrite|change).{0,20}melod/i.test(t)) commands.push({ op: 'improve', aspect: 'melody', range });
  if (/(different|new|another|better|improve|richer|change).{0,20}(chord|harmon(y|ies) progression|progression)/i.test(t)) commands.push({ op: 'improve', aspect: 'chords', range });
  if (/(different|new|another|better|improve|more powerful|bigger|punchier|harder).{0,25}(rhythm|drum|beat|groove|percussion)|(drums?|beat|rhythm).{0,25}(more powerful|bigger|punchier|harder|better)/i.test(t)) commands.push({ op: 'improve', aspect: 'rhythm', range });
  if (/\bharmon(y|ies|ize)\b/i.test(t) && !/progression/i.test(t)) commands.push({ op: 'harmonies', range });
  if (/\bvariation\b|vary it|something different/i.test(t)) commands.push({ op: 'variation', range });
  if (/(more|increase|raise|boost).{0,15}(energy|intense|intensity|power|drive)|more (dramatic|exciting|epic|aggressive|powerful)|much more dramatic|bigger|explosive/i.test(t)) commands.push({ op: 'energy', delta: /much|way|a lot|huge/i.test(t) ? 0.3 : 0.2, range });
  if (/(softer|gentler|calmer|less (energy|intense|busy)|more (relaxed|gentle|calm|minimal)|tone it down|soften)/i.test(t)) commands.push({ op: 'soften', range });
  if (/rising string|swelling string|string (crescendo|swell)/i.test(t)) {
    if (!p.tracks.some((x) => x.role === 'strings')) commands.push({ op: 'add_track', instrument: 'strings' });
    commands.push({ op: 'regenerate', range, roles: ['strings'] });
  }
  if (/\bhumani[sz]e\b|more human|less robotic|natural feel/i.test(t)) commands.push({ op: 'humanize', amount: 0.6, range });
  const q = /quantize(?: to)? (?:1\/)?(4|8|16|32)/i.exec(t);
  if (q) commands.push({ op: 'quantize', grid: 4 / parseInt(q[1], 10), strength: 1, range });
  else if (/\bquantize\b|tighten (up )?the timing/i.test(t)) commands.push({ op: 'quantize', grid: 0.25, strength: 1, range });
  const sw = /swing(?: to| of)? (\d+)\s*%?/i.exec(t);
  if (sw) commands.push({ op: 'swing', amount: Math.min(1, parseInt(sw[1], 10) / 100) });
  else if (/\b(add|more) swing\b|swing it/i.test(t)) commands.push({ op: 'swing', amount: 0.5 });
  const ext = /(?:extend|longer|add)\D{0,20}(\d+)\s*bars?/i.exec(t);
  if (ext && /extend|longer|add/i.test(t)) commands.push({ op: 'extend', bars: parseInt(ext[1], 10) });
  else if (/\b(extend|make it longer|lengthen)\b/i.test(t)) commands.push({ op: 'extend', bars: 8 });
  if (/new (ending|outro)|different ending|better ending/i.test(t)) commands.push({ op: 'new_section', which: 'outro' });
  if (/new intro|different intro|better intro/i.test(t)) commands.push({ op: 'new_section', which: 'intro' });
  if (/regenerate|re-?roll|try again|redo/i.test(t) && !commands.some((c) => c.op === 'improve')) commands.push({ op: 'regenerate', range, roles: inst ? undefined : undefined, tracks: inst ? [trackFor(inst.word)] : undefined });
  const master = /master(ing)?\s*(?:to|as|preset)?\s*(cinematic|pop|rock|electronic|acoustic|classical|lofi|podcast|clean)/i.exec(t);
  if (master) commands.push({ op: 'set_mastering', preset: master[2].toLowerCase() });
  if (/\blyrics?\b/i.test(t) && /(write|new|generate)/i.test(t)) commands.push({ op: 'write_lyrics', topic: /about ([\w ,']+)/i.exec(t)?.[1] ?? '' });

  // dedupe
  const seen = new Set<string>();
  const uniq = commands.filter((c) => { const k = JSON.stringify(c); if (seen.has(k)) return false; seen.add(k); return true; });
  if (!uniq.length) {
    return {
      reply: 'Local assistant (offline): I didn\'t recognise an edit I can perform. Try things like "the bass is too weak", "new melody for the chorus", "make the drums more powerful", "add a choir", "more energy in these bars", "make it jazz", "tempo 128 bpm", "extend by 8 bars", "new ending", "humanize". Connect Claude on the server for free-form requests.',
      commands: [],
    };
  }
  return { reply: `Local assistant: ${uniq.length} edit${uniq.length > 1 ? 's' : ''} planned${notes.length ? ` — ${notes.join('; ')}` : ''}.`, commands: uniq };
}
