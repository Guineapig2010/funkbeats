import { useMemo, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { humanizeNotes } from '../../model/clipOps';
import { newNote } from '../../model/factory';
import { DRUM_PIECES } from '../../model/presets';
import type { Clip, Note, Track } from '../../model/schema';
import { composeDrums } from '../../compose/parts';
import { rng } from '../../util/math';
import { useStudio } from '../../state/store';
import { replaceDrumSample } from '../../state/actions';
import type { DrumStyle } from '../../compose/styles';

const RES: [string, number][] = [['1/8', 0.5], ['1/16', 0.25], ['1/32', 0.125], ['1/8T', 1 / 3], ['1/16T', 1 / 6]];
const CORE = [36, 38, 39, 42, 46, 41, 45, 48, 49, 51, 37, 70, 54, 56, 35, 52, 57, 40, 44, 75];

export function DrumEditor({ clip, track }: { clip: Clip; track: Track }) {
  const [res, setRes] = useState(0.25);
  const [roll, setRoll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [replacePitch, setReplacePitch] = useState<number | null>(null);
  const project = useStudio((s) => s.project);
  const len = clip.loop ? clip.contentLength : clip.offset + clip.length;
  const steps = Math.min(256, Math.round(len / res));
  const bpb = (project.timeSignature.numerator * 4) / project.timeSignature.denominator;
  const used = new Set(clip.notes.map((n) => n.pitch));
  const [showAll, setShowAll] = useState(false);
  const lanes = DRUM_PIECES.filter((d) => showAll || used.has(d.pitch) || [36, 38, 39, 42, 46, 49].includes(d.pitch)).sort((a, b) => CORE.indexOf(a.pitch) - CORE.indexOf(b.pitch));
  const cellW = Math.max(14, Math.min(34, 900 / Math.max(16, steps)));

  const byCell = useMemo(() => {
    const m = new Map<string, Note[]>();
    for (const n of clip.notes) {
      const s = Math.floor(n.start / res + 1e-6);
      const k = `${n.pitch}:${s}`;
      (m.get(k) ?? m.set(k, []).get(k)!).push(n);
    }
    return m;
  }, [clip.notes, res]);

  const update = (fn: (ns: Note[]) => Note[], label: string, liveOnly = false) => {
    const st = useStudio.getState();
    const apply = (p: typeof st.project) => ({ ...p, tracks: p.tracks.map((t) => (t.id !== track.id ? t : { ...t, clips: t.clips.map((c) => (c.id === clip.id ? { ...c, notes: fn(c.notes) } : c)) })) });
    if (liveOnly) st.live(apply); else st.commit(label, apply);
  };
  const setClip = (patch: Partial<Clip>, label: string) => useStudio.getState().commit(label, (p) => ({ ...p, tracks: p.tracks.map((t) => (t.id !== track.id ? t : { ...t, clips: t.clips.map((c) => (c.id === clip.id ? { ...c, ...patch } : c)) })) }));

  const onCell = (e: React.PointerEvent, pitch: number, step: number) => {
    const k = `${pitch}:${step}`;
    const existing = byCell.get(k);
    if (existing?.length && !roll) {
      // drag vertically to change velocity; click without moving removes
      const startY = e.clientY;
      const base = existing.map((n) => n.velocity);
      let moved = false;
      useStudio.getState().beginGesture();
      const move = (ev: PointerEvent) => {
        const dy = startY - ev.clientY;
        if (Math.abs(dy) > 3) moved = true;
        if (moved) update((ns) => ns.map((n) => { const i = existing.findIndex((x) => x.id === n.id); return i >= 0 ? { ...n, velocity: Math.max(0.05, Math.min(1, base[i] + dy / 100)) } : n; }), '', true);
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (moved) useStudio.getState().endGesture('Drum velocity');
        else { useStudio.getState().cancelGesture(); update((ns) => ns.filter((n) => !existing.some((x) => x.id === n.id)), 'Remove hit'); }
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      return;
    }
    const vel = e.shiftKey ? 1 : e.altKey ? 0.35 : 0.8;
    const start = step * res;
    if (roll) {
      const n = e.shiftKey ? 4 : 3;
      const hits = Array.from({ length: n }, (_, i) => newNote(pitch, start + (i * res) / n, res / n, vel * (0.6 + (0.4 * i) / n)));
      update((ns) => [...ns.filter((x) => !(x.pitch === pitch && Math.floor(x.start / res + 1e-6) === step)), ...hits], 'Drum roll');
    } else update((ns) => [...ns, newNote(pitch, start, Math.min(res, 0.25), vel)], 'Add hit');
    engine.previewNote(track.id, pitch, vel, 0.2);
  };

  const regenerate = (fillOnly: boolean) => {
    const sec = project.sections.find((s) => clip.start >= s.start - 1e-6 && clip.start < s.start + s.length) ?? null;
    const bars = Math.max(1, Math.round(len / bpb));
    const style = (track.instrument.kit === 'orchestral' ? 'orchestral' : (project.style?.drums as DrumStyle) ?? 'backbeat');
    const notes = composeDrums({
      r: rng(Date.now() % 1e9), bars, bpb, chords: [], tonic: 0, mode: 'major', energy: sec?.energy ?? 0.7, kind: sec?.kind ?? 'verse', density: 0.5, syncopation: 0.4,
      complexity: 0.5, creativity: 0.6, center: 60, prevKind: null, nextKind: fillOnly ? 'chorus' : null, nextEnergy: fillOnly ? 1 : 0, prevEnergy: 0, isFirst: false, isLast: false, bpm: project.bpm,
    }, style, { humanize: 0.5 });
    if (fillOnly) {
      const fillStart = len - (sec && sec.energy > 0.7 ? 2 : 1);
      update((ns) => [...ns.filter((n) => n.start < fillStart), ...notes.filter((n) => n.start >= fillStart).map((n) => newNote(n.pitch, n.start, n.duration, n.velocity))], 'Drum fill');
    } else update(() => notes.map((n) => newNote(n.pitch, n.start, n.duration, n.velocity)), 'New drum pattern');
  };

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <b style={{ color: track.color }}>{track.name}</b><span className="dim small">· {clip.name} · step sequencer</span>
        <div className="sep" />
        <span className="small muted">Grid</span>
        {RES.map(([n, v]) => <button key={n} className={`btn sm ${Math.abs(res - v) < 1e-6 ? 'on' : ''}`} onClick={() => setRes(v)}>{n}</button>)}
        <button className={`btn sm ${roll ? 'on' : ''}`} onClick={() => setRoll(!roll)} title="Roll mode: click adds a 3-hit roll (Shift = 4)">Roll</button>
        <div className="sep" />
        <span className="small muted">Length</span>
        {[1, 2, 4, 8].map((b) => <button key={b} className={`btn sm ${Math.abs(len - b * bpb) < 1e-6 ? 'on' : ''}`} onClick={() => setClip({ contentLength: b * bpb, loop: true, offset: 0 }, 'Pattern length')}>{b} bar{b > 1 ? 's' : ''}</button>)}
        <div className="sep" />
        <button className="btn sm" onClick={() => regenerate(false)} title="New pattern in this song's style">Variation</button>
        <button className="btn sm" onClick={() => regenerate(true)}>Fill</button>
        <button className="btn sm" onClick={() => update((ns) => humanizeNotes(ns, 0.7, Date.now() % 1e6), 'Humanize drums')}>Humanize</button>
        <label className="row small">Swing<input type="range" min={0} max={1} step={0.05} value={clip.swing} style={{ width: 60 }} onChange={(e) => setClip({ swing: Number(e.target.value) }, 'Swing')} /></label>
        <button className="btn sm" onClick={() => update(() => [], 'Clear pattern')}>Clear</button>
        <label className="row small"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />All pieces</label>
        <span className="dim small hide-sm">Click = hit · Shift = accent · Alt = ghost · drag ↕ = velocity</span>
      </div>
      <div className="editor-body scroll" style={{ padding: 8 }}>
        <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f && replacePitch !== null) void replaceDrumSample(track.id, replacePitch, f); e.target.value = ''; }} />
        <div style={{ display: 'grid', gridTemplateColumns: `150px repeat(${steps}, ${cellW}px)`, gap: 2, width: 'max-content' }}>
          {lanes.map((d) => {
            const piece = track.instrument.pieces[String(d.pitch)];
            return [
              <div key={`h${d.pitch}`} className="row small" style={{ gap: 4, paddingRight: 4 }}>
                <button className="btn sm ghost" style={{ flex: 1, justifyContent: 'flex-start' }} onClick={() => engine.previewNote(track.id, d.pitch, 0.85, 0.3)} title="Audition">{d.name}</button>
                <button className={`btn sm ${piece?.sampleAssetId ? 'on' : ''}`} title={piece?.sampleAssetId ? `Sample: ${engine.assets.names.get(piece.sampleAssetId) ?? 'loaded'} (click to replace)` : 'Replace with your own sample'} onClick={() => { setReplacePitch(d.pitch); fileRef.current?.click(); }}>⤓</button>
              </div>,
              ...Array.from({ length: steps }, (_, s) => {
                const hits = byCell.get(`${d.pitch}:${s}`);
                const v = hits ? Math.max(...hits.map((h) => h.velocity)) : 0;
                const beatStart = Math.abs((s * res) % 1) < 1e-6;
                const barStart = Math.abs((s * res) % bpb) < 1e-6;
                return (
                  <div key={`${d.pitch}:${s}`} onPointerDown={(e) => onCell(e, d.pitch, s)}
                    style={{ height: 22, borderRadius: 3, cursor: 'pointer', background: hits ? `rgba(255,138,61,${0.3 + 0.7 * v})` : barStart ? '#2a2f3b' : beatStart ? '#222631' : '#1a1d24', border: hits && hits.length > 1 ? '1px solid #fff' : '1px solid transparent', position: 'relative' }}
                    title={hits ? `${hits.length > 1 ? `roll ×${hits.length}, ` : ''}velocity ${Math.round(v * 127)}` : ''}>
                    {hits && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${v * 100}%`, background: '#ffffff22' }} />}
                  </div>
                );
              }),
            ];
          })}
        </div>
      </div>
    </div>
  );
}
