import { useEffect, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { EFFECT_DEFS } from '../../model/effects';
import type { AutomationLane, Track } from '../../model/schema';
import { MeterMap } from '../../model/tempo';
import { projectEndBeat } from '../../model/factory';
import { uid } from '../../util/id';
import { useStudio } from '../../state/store';

interface TargetDef { id: string; label: string; min: number; max: number; def: number; unit: string; log?: boolean }

export function automationTargets(t: Track): TargetDef[] {
  const out: TargetDef[] = [
    { id: 'volume', label: 'Volume', min: -60, max: 6, def: t.volume, unit: 'dB' },
    { id: 'pan', label: 'Pan', min: -1, max: 1, def: t.pan, unit: '' },
  ];
  if (t.type !== 'audio' && t.instrument.kind !== 'drumkit') out.push({ id: 'inst.cutoff', label: 'Synth filter cutoff (per note)', min: 40, max: 18000, def: t.instrument.params.filter.cutoff, unit: 'Hz', log: true }, { id: 'inst.resonance', label: 'Synth resonance (per note)', min: 0.1, max: 20, def: t.instrument.params.filter.resonance, unit: '' });
  for (const s of t.sends) out.push({ id: `send.${s.returnId}`, label: `Send → ${s.returnId.replace('ret-', '')}`, min: 0, max: 1, def: s.level, unit: '' });
  for (const fx of t.effects) for (const pd of EFFECT_DEFS[fx.type].params) out.push({ id: `fx.${fx.id}.${pd.key}`, label: `${EFFECT_DEFS[fx.type].name}: ${pd.label}`, min: pd.min, max: pd.max, def: Number(fx.params[pd.key] ?? pd.default), unit: pd.unit ?? '', log: pd.log });
  return out;
}

export function AutomationEditor() {
  const sel = useStudio((s) => s.selectedTrackIds[0]);
  const t = useStudio((s) => s.project.tracks.find((x) => x.id === sel));
  const project = useStudio((s) => s.project);
  const zoom = useStudio((s) => s.zoom);
  const targetId = useStudio((s) => s.automationTarget);
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [scroll, setScroll] = useState(0);
  const H = 180;
  useEffect(() => { const el = wrap.current; if (!el) return; const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); return () => ro.disconnect(); }, []);
  const targets = t ? automationTargets(t) : [];
  const target = targets.find((x) => x.id === targetId) ?? targets[0];
  const lane = t?.automation.find((a) => a.target === target?.id);
  const toN = (v: number) => (target?.log ? Math.log(v / target.min) / Math.log(target.max / target.min) : (v - target!.min) / (target!.max - target!.min));
  const fromN = (n: number) => { const c = Math.max(0, Math.min(1, n)); return target?.log ? target.min * Math.pow(target.max / target.min, c) : target!.min + c * (target!.max - target!.min); };

  useEffect(() => {
    const c = ref.current;
    if (!c || !t || !target) return;
    const dpr = devicePixelRatio;
    c.width = w * dpr; c.height = H * dpr; c.style.width = `${w}px`; c.style.height = `${H}px`;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0f1115'; g.fillRect(0, 0, w, H);
    const meter = MeterMap.fromProject(project);
    for (const b of meter.bars(scroll / zoom, (scroll + w) / zoom)) { const x = b.beat * zoom - scroll; g.fillStyle = '#262a33'; g.fillRect(x, 0, 1, H); g.fillStyle = '#6f7686'; g.font = '10px monospace'; g.fillText(String(b.bar + 1), x + 2, 10); }
    for (const s of project.sections) { const x = s.start * zoom - scroll; g.fillStyle = '#3a4050'; g.fillText(s.name, x + 2, H - 4); }
    // default line
    const yOf = (v: number) => H - 14 - toN(v) * (H - 28);
    g.strokeStyle = '#3a4050'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(0, yOf(target.def)); g.lineTo(w, yOf(target.def)); g.stroke(); g.setLineDash([]);
    if (lane && lane.points.length) {
      const pts = [...lane.points].sort((a, b) => a.beat - b.beat);
      g.strokeStyle = lane.enabled ? t.color : '#555'; g.lineWidth = 2; g.beginPath();
      g.moveTo(0, yOf(pts[0].value));
      for (const p of pts) g.lineTo(p.beat * zoom - scroll, yOf(p.value));
      g.lineTo(w, yOf(pts[pts.length - 1].value)); g.stroke(); g.lineWidth = 1;
      for (const p of pts) { g.fillStyle = '#fff'; g.beginPath(); g.arc(p.beat * zoom - scroll, yOf(p.value), 4, 0, Math.PI * 2); g.fill(); }
    }
  }, [t, target, lane, w, zoom, scroll, project.sections, project.timeSignature]);

  if (!t || !target) return <div className="empty-state">Select a track to draw automation.</div>;
  const write = (fn: (pts: AutomationLane['points']) => AutomationLane['points'], liveOnly: boolean, label = 'Edit automation') => {
    const apply = (p: typeof project) => ({
      ...p, tracks: p.tracks.map((x) => {
        if (x.id !== t.id) return x;
        const existing = x.automation.find((a) => a.target === target.id);
        const l: AutomationLane = existing ? { ...existing, points: fn(existing.points) } : { id: uid('au'), target: target.id, enabled: true, points: fn([]) };
        return { ...x, automation: [...x.automation.filter((a) => a.target !== target.id), l] };
      }),
    });
    if (liveOnly) useStudio.getState().live(apply); else useStudio.getState().commit(label, apply);
  };
  const posOf = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { beat: Math.max(0, (e.clientX - r.left + scroll) / zoom), value: fromN((H - 14 - (e.clientY - r.top)) / (H - 28)) };
  };
  const onDown = (e: React.PointerEvent) => {
    const { beat, value } = posOf(e);
    const pts = lane?.points ?? [];
    const hitIdx = pts.findIndex((p) => Math.abs(p.beat * zoom - scroll - (e.clientX - ref.current!.getBoundingClientRect().left)) < 7);
    if (e.button === 2 || e.altKey) { if (hitIdx >= 0) write((ps) => ps.filter((_, i) => i !== hitIdx), false, 'Delete point'); return; }
    useStudio.getState().beginGesture();
    if (hitIdx < 0) write((ps) => [...ps, { beat, value }].sort((a, b) => a.beat - b.beat), true);
    const startBeat = hitIdx >= 0 ? pts[hitIdx].beat : beat;
    const move = (ev: PointerEvent) => {
      const q = posOf(ev);
      if (ev.shiftKey) {
        // freehand draw
        write((ps) => [...ps.filter((p) => Math.abs(p.beat - q.beat) > 0.12), { beat: q.beat, value: q.value }].sort((a, b) => a.beat - b.beat), true);
      } else write((ps) => ps.map((p) => (Math.abs(p.beat - startBeat) < 1e-6 || p === ps.find((x) => Math.abs(x.beat - startBeat) < 1e-6) ? { beat: q.beat, value: q.value } : p)).sort((a, b) => a.beat - b.beat), true);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); useStudio.getState().endGesture('Edit automation'); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const end = Math.max(projectEndBeat(project), 16);
  return (
    <div className="editor">
      <div className="editor-toolbar">
        <b style={{ color: t.color }}>{t.name}</b>
        <select className="input" value={target.id} onChange={(e) => useStudio.getState().set({ automationTarget: e.target.value })} aria-label="Automation target">
          {targets.map((x) => <option key={x.id} value={x.id}>{x.label}{t.automation.some((a) => a.target === x.id && a.points.length) ? ' ●' : ''}</option>)}
        </select>
        <label className="row small"><input type="checkbox" checked={lane?.enabled ?? true} disabled={!lane} onChange={(e) => useStudio.getState().commit('Toggle automation', (p) => ({ ...p, tracks: p.tracks.map((x) => (x.id === t.id ? { ...x, automation: x.automation.map((a) => (a.target === target.id ? { ...a, enabled: e.target.checked } : a)) } : x)) }))} />Active</label>
        <button className="btn sm" disabled={!lane} onClick={() => write(() => [], false, 'Clear automation')}>Clear</button>
        <button className="btn sm" onClick={() => { const pos = engine.playing ? engine.positionBeat() : useStudio.getState().cursorBeat; write((ps) => [...ps, { beat: pos, value: target.def }].sort((a, b) => a.beat - b.beat), false, 'Add point'); }}>+ Point at cursor</button>
        <span className="dim small">Click: add/drag point · Shift+drag: draw · Alt/right-click: delete. Automation plays live and in export.</span>
      </div>
      <div className="editor-body" ref={wrap} onWheel={(e) => setScroll((s) => Math.max(0, Math.min(end * zoom, s + (e.deltaX || e.deltaY))))}>
        <canvas ref={ref} onPointerDown={onDown} onContextMenu={(e) => e.preventDefault()} style={{ cursor: 'crosshair' }} />
      </div>
    </div>
  );
}
