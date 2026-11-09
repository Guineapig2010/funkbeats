/** Standard MIDI File (SMF type 0/1) reader and writer. */
import { newMidiClip, newNote, newProject, newTrack } from '../model/factory';
import type { Project, Track } from '../model/schema';
import { expandClipNotes } from '../model/clipOps';
import { GM_PROGRAM_PRESETS } from './gm';

export interface MidiNote { pitch: number; start: number; duration: number; velocity: number; channel: number }
export interface MidiTrackData { name: string; notes: MidiNote[]; program: number | null; channel: number }
export interface MidiFileData { ppq: number; tempos: { beat: number; bpm: number }[]; timeSig: { numerator: number; denominator: number } | null; tracks: MidiTrackData[]; keySig: { sf: number; minor: boolean } | null }

class Reader {
  pos = 0;
  constructor(private v: DataView) {}
  u8() { return this.v.getUint8(this.pos++); }
  u16() { const x = this.v.getUint16(this.pos); this.pos += 2; return x; }
  u32() { const x = this.v.getUint32(this.pos); this.pos += 4; return x; }
  str(n: number) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8()); return s; }
  vlq() { let x = 0; for (let i = 0; i < 4; i++) { const b = this.u8(); x = (x << 7) | (b & 0x7f); if (!(b & 0x80)) break; } return x; }
  get eof() { return this.pos >= this.v.byteLength; }
}

export function parseMidi(ab: ArrayBuffer): MidiFileData {
  const r = new Reader(new DataView(ab));
  if (r.str(4) !== 'MThd') throw new Error('Not a MIDI file (missing MThd header)');
  const hl = r.u32();
  const format = r.u16();
  const ntracks = r.u16();
  const division = r.u16();
  r.pos = 8 + hl;
  if (division & 0x8000) throw new Error('SMPTE time-based MIDI files are not supported');
  if (format > 1) throw new Error('MIDI format 2 is not supported');
  const ppq = division;
  const tempos: { beat: number; bpm: number }[] = [];
  let timeSig: MidiFileData['timeSig'] = null;
  let keySig: MidiFileData['keySig'] = null;
  const tracks: MidiTrackData[] = [];
  for (let t = 0; t < ntracks && !r.eof; t++) {
    const id = r.str(4);
    const len = r.u32();
    const end = r.pos + len;
    if (id !== 'MTrk') { r.pos = end; continue; }
    let tick = 0, status = 0, name = '';
    const open = new Map<number, { tick: number; vel: number }[]>();
    const byChannel = new Map<number, MidiNote[]>();
    const programs = new Map<number, number>();
    const close = (ch: number, pitch: number, at: number) => {
      const k = ch * 128 + pitch;
      const stack = open.get(k);
      const on = stack?.shift();
      if (!on) return;
      const list = byChannel.get(ch) ?? [];
      list.push({ pitch, start: on.tick / ppq, duration: Math.max(1 / 64, (at - on.tick) / ppq), velocity: on.vel / 127, channel: ch });
      byChannel.set(ch, list);
    };
    while (r.pos < end) {
      tick += r.vlq();
      let b = r.u8();
      if (b < 0x80) { r.pos--; b = status; } else if (b < 0xf0) status = b;
      const type = b & 0xf0, ch = b & 0x0f;
      if (b === 0xff) {
        const mt = r.u8(); const ml = r.vlq(); const st = r.pos;
        if (mt === 0x03) name = r.str(ml);
        else if (mt === 0x51 && ml === 3) { const us = (r.u8() << 16) | (r.u8() << 8) | r.u8(); tempos.push({ beat: tick / ppq, bpm: 60000000 / us }); }
        else if (mt === 0x58 && ml >= 2 && !timeSig) { const n = r.u8(); const d = Math.pow(2, r.u8()); timeSig = { numerator: n, denominator: d }; }
        else if (mt === 0x59 && ml === 2 && !keySig) { const sf = (r.u8() << 24) >> 24; const mi = r.u8(); keySig = { sf, minor: mi === 1 }; }
        r.pos = st + ml;
      } else if (b === 0xf0 || b === 0xf7) { r.pos += r.vlq(); }
      else if (type === 0x90) { const p = r.u8(), v = r.u8(); if (v === 0) close(ch, p, tick); else { const k = ch * 128 + p; (open.get(k) ?? open.set(k, []).get(k)!).push({ tick, vel: v }); } }
      else if (type === 0x80) { const p = r.u8(); r.u8(); close(ch, p, tick); }
      else if (type === 0xc0) programs.set(ch, r.u8());
      else if (type === 0xd0) r.u8();
      else if (type === 0xa0 || type === 0xb0 || type === 0xe0) { r.u8(); r.u8(); }
      else break;
    }
    for (const [k] of open) { const ch = Math.floor(k / 128), p = k % 128; while (open.get(k)?.length) close(ch, p, tick); }
    for (const [ch, notes] of byChannel) tracks.push({ name: name || `Track ${tracks.length + 1}`, notes: notes.sort((a, b) => a.start - b.start), program: programs.get(ch) ?? null, channel: ch });
    r.pos = end;
  }
  return { ppq, tempos: tempos.sort((a, b) => a.beat - b.beat), timeSig, tracks, keySig };
}

/** Import MIDI as tracks (drums on channel 10 map to the drum kit). */
export function midiToTracks(m: MidiFileData, startIndex = 0): Track[] {
  return m.tracks.filter((t) => t.notes.length).map((t, i) => {
    const drums = t.channel === 9;
    const preset = drums ? 'kit-acoustic' : GM_PROGRAM_PRESETS(t.program ?? 0);
    const tr = newTrack({ preset, name: t.name, role: drums ? 'drums' : 'other' }, startIndex + i);
    const end = t.notes.reduce((mx, n) => Math.max(mx, n.start + n.duration), 0);
    const len = Math.max(4, Math.ceil(end / 4) * 4);
    tr.clips = [newMidiClip(0, len, t.notes.map((n) => newNote(n.pitch, n.start, n.duration, n.velocity)), t.name)];
    return tr;
  });
}

export function midiToProject(m: MidiFileData, name: string): Project {
  const p = newProject(name);
  if (m.tempos.length) {
    p.bpm = Math.round(m.tempos[0].bpm * 100) / 100;
    p.tempoChanges = m.tempos.slice(1).filter((t) => t.beat > 0).map((t) => ({ beat: t.beat, bpm: Math.round(t.bpm * 100) / 100 }));
  }
  if (m.timeSig && [2, 4, 8, 16].includes(m.timeSig.denominator)) p.timeSignature = { numerator: m.timeSig.numerator, denominator: m.timeSig.denominator as 4 };
  if (m.keySig) {
    const majorTonic = ((m.keySig.sf * 7) % 12 + 12) % 12;
    p.key = m.keySig.minor ? { tonic: (majorTonic + 9) % 12, mode: 'minor' } : { tonic: majorTonic, mode: 'major' };
  }
  p.tracks = midiToTracks(m);
  return p;
}

// ---------------- writer ----------------
function vlq(n: number): number[] {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) { out.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return out;
}
const strBytes = (s: string) => Array.from(new TextEncoder().encode(s));

/** Export the project (or a subset of tracks) as a type-1 SMF with tempo map and time signature. */
export function projectToMidi(p: Project, trackIds?: string[]): Uint8Array {
  const ppq = 480;
  const chunks: number[][] = [];
  // conductor track
  const meta: [number, number[]][] = [];
  const tempoEv = (bpm: number) => { const us = Math.round(60000000 / bpm); return [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]; };
  meta.push([0, [0xff, 0x03, ...vlq(strBytes(p.name).length), ...strBytes(p.name)]]);
  meta.push([0, [0xff, 0x58, 0x04, p.timeSignature.numerator, Math.log2(p.timeSignature.denominator), 24, 8]]);
  meta.push([0, tempoEv(p.bpm)]);
  for (const t of p.tempoChanges) meta.push([Math.round(t.beat * ppq), tempoEv(t.bpm)]);
  for (const s of p.sections) meta.push([Math.round(s.start * ppq), [0xff, 0x06, ...vlq(strBytes(s.name).length), ...strBytes(s.name)]]);
  chunks.push(trackChunk(meta));
  let ch = 0;
  for (const t of p.tracks) {
    if (trackIds && !trackIds.includes(t.id)) continue;
    if (t.type === 'audio') continue;
    const channel = t.type === 'drums' ? 9 : ch;
    if (t.type !== 'drums') { ch++; if (ch === 9) ch++; if (ch > 15) ch = 0; }
    const ev: [number, number[]][] = [[0, [0xff, 0x03, ...vlq(strBytes(t.name).length), ...strBytes(t.name)]]];
    for (const c of t.clips) for (const n of expandClipNotes(c)) {
      const on = Math.round(n.start * ppq), off = Math.round((n.start + n.duration) * ppq);
      const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));
      ev.push([on, [0x90 | channel, n.pitch, vel]]);
      ev.push([Math.max(on + 1, off), [0x80 | channel, n.pitch, 0]]);
      if (n.lyric) ev.push([on, [0xff, 0x05, ...vlq(strBytes(n.lyric).length), ...strBytes(n.lyric)]]);
    }
    chunks.push(trackChunk(ev));
  }
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (chunks.length >> 8) & 0xff, chunks.length & 0xff, (ppq >> 8) & 0xff, ppq & 0xff];
  return new Uint8Array([...header, ...chunks.flat()]);
}

function trackChunk(events: [number, number[]][]): number[] {
  // note-offs before note-ons at the same tick
  events.sort((a, b) => a[0] - b[0] || ((a[1][0] & 0xf0) === 0x80 ? -1 : 0) - ((b[1][0] & 0xf0) === 0x80 ? -1 : 0));
  const data: number[] = [];
  let last = 0;
  for (const [tick, bytes] of events) { data.push(...vlq(tick - last), ...bytes); last = tick; }
  data.push(0, 0xff, 0x2f, 0);
  const n = data.length;
  return [0x4d, 0x54, 0x72, 0x6b, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, ...data];
}
