/**
 * Local lyric tools: syllable splitting (for note alignment) and a simple, clearly
 * template-based original lyric writer used when Claude is not configured.
 */
import { rng, hashString } from '../util/math';
import type { SectionKind } from '../model/schema';

/** Heuristic English syllabification (vowel groups with common silent-e handling). */
export function syllables(word: string): string[] {
  const w = word.replace(/[^A-Za-z']/g, '');
  if (!w) return [];
  if (w.length <= 3) return [word];
  const lower = w.toLowerCase();
  const parts: string[] = [];
  let cur = '';
  const isV = (ch: string) => 'aeiouy'.includes(ch);
  for (let i = 0; i < lower.length; i++) {
    cur += w[i];
    const ch = lower[i], next = lower[i + 1], next2 = lower[i + 2];
    if (isV(ch) && next && !isV(next)) {
      // split VC|CV, but keep consonant clusters at the end and silent e
      if (next2 && !isV(next2) && i + 2 < lower.length) { cur += w[i + 1]; i++; parts.push(cur); cur = ''; }
      else if (next2 && isV(next2) && !(next2 === 'e' && i + 3 === lower.length)) { parts.push(cur); cur = ''; }
    }
  }
  if (cur) {
    if (parts.length && !/[aeiouy]/i.test(cur)) parts[parts.length - 1] += cur; else parts.push(cur);
  }
  return parts.length ? parts : [word];
}

/** Split a lyric line into syllables; continuation syllables are prefixed with '-' for display. */
export function lineSyllables(line: string): string[] {
  const out: string[] = [];
  for (const word of line.split(/\s+/).filter(Boolean)) {
    const s = syllables(word);
    s.forEach((x, i) => out.push(i === 0 ? x : '-' + x));
  }
  return out;
}

const BANK: Record<string, { images: string[]; verbs: string[]; feelings: string[]; hooks: string[] }> = {
  heroic: { images: ['the mountain', 'the morning sun', 'a burning sky', 'the open road', 'the city lights'], verbs: ['rise', 'stand', 'fight', 'run', 'climb'], feelings: ['brave', 'alive', 'unbroken', 'strong'], hooks: ['We rise again', 'Hold the line', 'Never fall'] },
  sad: { images: ['an empty room', 'the falling rain', 'a faded photograph', 'the winter street', 'your silent phone'], verbs: ['wait', 'drift', 'fade', 'break', 'remember'], feelings: ['alone', 'lost', 'cold', 'undone'], hooks: ['Where did you go', 'Let it rain', 'Still I wait'] },
  happy: { images: ['the summer air', 'a golden day', 'the radio', 'the dancing crowd', 'your shining eyes'], verbs: ['dance', 'sing', 'shine', 'jump', 'laugh'], feelings: ['free', 'bright', 'so good', 'alive'], hooks: ['Feel the light', 'Turn it up', 'Here we go'] },
  dark: { images: ['the shadow hall', 'a midnight road', 'the broken glass', 'the silent storm', 'the hollow moon'], verbs: ['hide', 'burn', 'fall', 'haunt', 'crawl'], feelings: ['afraid', 'numb', 'restless', 'cold'], hooks: ['Into the dark', 'No way out', 'Hear the storm'] },
  love: { images: ['your hand in mine', 'the candle light', 'a quiet street', 'the ocean side', 'the starry night'], verbs: ['hold', 'stay', 'fall', 'dream', 'breathe'], feelings: ['home', 'safe', 'in love', 'complete'], hooks: ['Stay with me', 'You and I', 'Only you'] },
  neutral: { images: ['the evening sky', 'the empty road', 'the river bend', 'the window light', 'the passing train'], verbs: ['go', 'move', 'turn', 'wonder', 'follow'], feelings: ['awake', 'unsure', 'okay', 'alive'], hooks: ['Let it go', 'Carry on', 'All we need'] },
};
const moodBank = (mood: string) => BANK[mood === 'epic' || mood === 'motivational' || mood === 'uplifting' ? 'heroic' : mood === 'emotional' ? 'sad' : mood === 'romantic' ? 'love' : mood === 'intense' || mood === 'mysterious' ? 'dark' : mood === 'energetic' || mood === 'chill' || mood === 'peaceful' ? 'happy' : mood] ?? BANK.neutral;

/**
 * Template-based lyrics – original but simple. The UI labels them as such and
 * offers Claude for real lyric writing.
 */
export function writeLyrics(kind: SectionKind, mood: string, lines: number, seed: number, topic = ''): string {
  const r = rng(seed ^ hashString(kind + mood + topic));
  const b = moodBank(mood);
  const hook = r.pick(b.hooks);
  const out: string[] = [];
  const subject = topic.trim() ? topic.trim().split(/\s+/).slice(0, 3).join(' ') : r.pick(b.images);
  for (let i = 0; i < lines; i++) {
    if (kind === 'chorus' || kind === 'postchorus') {
      out.push(i % 2 === 0 ? hook : r.pick([`we ${r.pick(b.verbs)} beneath ${r.pick(b.images)}`, `and I feel ${r.pick(b.feelings)} tonight`, `${r.pick(b.verbs)} with me, ${r.pick(b.verbs)} with me`]));
    } else if (kind === 'prechorus' || kind === 'buildup') {
      out.push(r.pick([`I can feel it coming now`, `every heartbeat getting loud`, `just a little closer now`, `don't you wait, don't you wait`]));
    } else if (kind === 'bridge') {
      out.push(r.pick([`and if the world should ${r.pick(b.verbs)}`, `I'll still be ${r.pick(b.feelings)}`, `through ${r.pick(b.images)}`, `we were never meant to ${r.pick(b.verbs)}`]));
    } else {
      out.push(r.pick([`I ${r.pick(b.verbs)} through ${subject}`, `${r.pick(b.images)} calls my name`, `I was ${r.pick(b.feelings)} and I didn't know`, `we ${r.pick(b.verbs)} until the night is gone`, `there's a light in ${r.pick(b.images)}`]));
    }
  }
  return out.map((l) => l.charAt(0).toUpperCase() + l.slice(1)).join('\n');
}
