import type { Project, SignatureChange, TempoChange } from './schema';

/**
 * Tempo map: converts between beats and seconds with step tempo changes.
 * Built once per project change and reused by transport, renderer and UI.
 */
export class TempoMap {
  readonly segments: { beat: number; sec: number; bpm: number }[];
  constructor(bpm: number, changes: TempoChange[] = []) {
    const sorted = [...changes].filter((c) => c.beat > 0).sort((a, b) => a.beat - b.beat);
    const segs = [{ beat: 0, sec: 0, bpm }];
    for (const c of sorted) {
      const last = segs[segs.length - 1];
      if (Math.abs(c.beat - last.beat) < 1e-9) {
        last.bpm = c.bpm;
        continue;
      }
      const sec = last.sec + ((c.beat - last.beat) * 60) / last.bpm;
      segs.push({ beat: c.beat, sec, bpm: c.bpm });
    }
    this.segments = segs;
  }
  static fromProject(p: Pick<Project, 'bpm' | 'tempoChanges'>) {
    return new TempoMap(p.bpm, p.tempoChanges);
  }
  private segForBeat(beat: number) {
    const s = this.segments;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].beat <= beat) lo = mid; else hi = mid - 1;
    }
    return s[lo];
  }
  private segForSec(sec: number) {
    const s = this.segments;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].sec <= sec) lo = mid; else hi = mid - 1;
    }
    return s[lo];
  }
  beatToSec(beat: number): number {
    const seg = this.segForBeat(beat);
    return seg.sec + ((beat - seg.beat) * 60) / seg.bpm;
  }
  secToBeat(sec: number): number {
    const seg = this.segForSec(sec);
    return seg.beat + ((sec - seg.sec) * seg.bpm) / 60;
  }
  bpmAt(beat: number): number {
    return this.segForBeat(beat).bpm;
  }
}

/** Bar/beat grid that respects time-signature changes. Signature changes snap to bar lines. */
export class MeterMap {
  readonly segs: { beat: number; bar: number; beatsPerBar: number; numerator: number; denominator: number }[];
  constructor(base: { numerator: number; denominator: number }, changes: SignatureChange[] = []) {
    const bpb = (n: number, d: number) => (n * 4) / d;
    const segs = [{ beat: 0, bar: 0, beatsPerBar: bpb(base.numerator, base.denominator), ...base }];
    for (const c of [...changes].filter((c) => c.beat > 0).sort((a, b) => a.beat - b.beat)) {
      const last = segs[segs.length - 1];
      // snap to the next bar line of the current meter
      const barsIn = Math.ceil((c.beat - last.beat) / last.beatsPerBar - 1e-9);
      const beat = last.beat + barsIn * last.beatsPerBar;
      const seg = { beat, bar: last.bar + barsIn, beatsPerBar: bpb(c.numerator, c.denominator), numerator: c.numerator, denominator: c.denominator };
      if (beat === last.beat) segs[segs.length - 1] = seg; else segs.push(seg);
    }
    this.segs = segs;
  }
  static fromProject(p: Pick<Project, 'timeSignature' | 'signatureChanges'>) {
    return new MeterMap(p.timeSignature, p.signatureChanges);
  }
  segAt(beat: number) {
    let s = this.segs[0];
    for (const x of this.segs) if (x.beat <= beat + 1e-9) s = x; else break;
    return s;
  }
  barToBeat(bar: number): number {
    let s = this.segs[0];
    for (const x of this.segs) if (x.bar <= bar) s = x; else break;
    return s.beat + (bar - s.bar) * s.beatsPerBar;
  }
  beatToBar(beat: number): { bar: number; beatInBar: number; seg: MeterMap['segs'][number] } {
    const s = this.segAt(beat);
    const rel = beat - s.beat;
    const barOff = Math.floor(rel / s.beatsPerBar + 1e-9);
    return { bar: s.bar + barOff, beatInBar: rel - barOff * s.beatsPerBar, seg: s };
  }
  /** Iterate bar lines in [from, to). */
  *bars(from: number, to: number) {
    let { bar } = this.beatToBar(Math.max(0, from));
    for (let i = 0; i < 100000; i++) {
      const b = this.barToBeat(bar);
      if (b >= to) return;
      yield { bar, beat: b, seg: this.segAt(b) };
      bar++;
    }
  }
}

export function formatBarsBeats(beat: number, meter: MeterMap): string {
  const { bar, beatInBar, seg } = meter.beatToBar(beat);
  const beatUnit = 4 / seg.denominator;
  const b = Math.floor(beatInBar / beatUnit + 1e-9);
  const ticks = Math.floor(((beatInBar - b * beatUnit) / beatUnit) * 100 + 1e-6);
  return `${bar + 1}.${b + 1}.${String(ticks).padStart(2, '0')}`;
}

export function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(2).padStart(5, '0')}`;
}
