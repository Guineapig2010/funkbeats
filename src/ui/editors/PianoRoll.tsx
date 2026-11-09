import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { dedupeNotes, humanizeNotes, legato, quantizeNotes, scaleVelocities, transposeNotes } from '../../model/clipOps';
import { newNote } from '../../model/factory';
import type { Clip, Note, Track } from '../../model/schema';
import { CHORD_QUALITIES, chordPitchClasses, diatonicChord, inScale, noteName, pc, snapToScale, degreeOf } from '../../theory/theory';
import { uid } from '../../util/id';
import { useStudio } from '../../state/store';
import type { Voice } from '../../audio/instruments/synths';

const KEYS_W = 54;
const VEL_H = 64;
const isBlack = (p: number) => [1, 3, 6, 8, 10].includes(p % 12);

type Drag =
  | { kind: 'move'; startBeat: number; startPitch: number; base: Note[]; ids: string[] }
  | { kind: 'resize'; startBeat: number; base: Note[]; ids: string[] }
  | { kind: 'box'; b0: number; p0: number; b1: number; p1: number }
  | { kind: 'draw'; id: string; start: number }
  | { kind: 'vel'; }
  | null;

export function PianoRoll({ clip, track }: { clip: Clip; track: Track }) {
  const project = useStudio((s) => s.project);
  const grid = useStudio((s) => s.grid);
  const snapOn = useStudio((s) => s.snap);
  const [zoomX, setZoomX] = useState(64);
  const [rowH, setRowH] = useState(12);
  const [scrollX, setScrollX] = useState(0);
  const [topPitch, setTopPitch] = useState(() => {
    const ps = clip.notes.map((n) => n.pitch);
    return ps.length ? Math.min(127, Math.max(...ps) + 6) : 84;
  });
  const [sel, setSel] = useState<string[]>([]);
  const [tool, setTool] = useState<'select' | 'draw' | 'erase' | 'chord'>('draw');
  const [scaleSnap, setScaleSnap] = useState(false);
  const [chordQ, setChordQ] = useState<'diatonic' | string>('diatonic');
  const [lastLen, setLastLen] = useState(1);
  const [qStrength, setQStrength] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>(null);
  const [size, setSize] = useState({ w: 800, h: 260 });
  const [, force] = useState(0);
  const voiceRef = useRef<Voice | null>(null);
  const gridBeats = grid === 0 ? (project.timeSignature.numerator * 4) / project.timeSignature.denominator : grid;
  const snapB = useCallback((b: number) => (snapOn ? Math.round(b / gridBeats) * gridBeats : b), [snapOn, gridBeats]);
  const key = project.key;

  useEffect(() => { setSel([]); }, [clip.id]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const gridH = size.h - VEL_H;
  const updateNotes = useCallback((fn: (ns: Note[]) => Note[], label?: string) => {
    const st = useStudio.getState();
    const apply = (p: typeof st.project) => ({ ...p, tracks: p.tracks.map((t) => (t.id !== track.id ? t : { ...t, clips: t.clips.map((c) => (c.id === clip.id ? { ...c, notes: fn(c.notes) } : c)) })) });
    if (label) st.commit(label, apply); else st.live(apply);
  }, [track.id, clip.id]);

  // coordinate helpers
  const xToBeat = (x: number) => (x - KEYS_W + scrollX) / zoomX + clip.offset;
  const beatToX = (b: number) => (b - clip.offset) * zoomX - scrollX + KEYS_W;
  const yToPitch = (y: number) => Math.round(topPitch - y / rowH + 0.5);
  const pitchToY = (p: number) => (topPitch - p) * rowH;

  const noteAt = (x: number, y: number): { n: Note; edge: boolean } | null => {
    const b = xToBeat(x), p = yToPitch(y);
    for (let i = clip.notes.length - 1; i >= 0; i--) {
      const n = clip.notes[i];
      if (n.pitch === p && b >= n.start && b <= n.start + n.duration) {
        const edgeX = beatToX(n.start + n.duration);
        return { n, edge: edgeX - x < 7 && n.duration * zoomX > 10 };
      }
    }
    return null;
  };

  // ---------------- draw ----------------
  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = devicePixelRatio;
    const W = size.w, H = size.h;
    if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; c.style.width = `${W}px`; c.style.height = `${H}px`; }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0f1115'; g.fillRect(0, 0, W, H);
    const rows = Math.ceil(gridH / rowH) + 1;
    // rows
    for (let i = 0; i < rows; i++) {
      const p = topPitch - i;
      if (p < 0) break;
      const y = i * rowH;
      const inK = inScale(p, key.tonic, key.mode);
      g.fillStyle = isBlack(p) ? '#121419' : '#171a20';
      if (inK) g.fillStyle = isBlack(p) ? '#161a20' : '#1b1f27';
      if (pc(p - key.tonic) === 0) g.fillStyle = '#20252f';
      g.fillRect(KEYS_W, y, W - KEYS_W, rowH);
      if (p % 12 === 0) { g.fillStyle = '#2b303b'; g.fillRect(KEYS_W, y + rowH - 1, W, 1); }
    }
    // chord highlight (chord tones of the chord under each region)
    const clipAbs = clip.start - clip.offset;
    for (const ch of project.chords) {
      const x0 = beatToX(ch.start - clipAbs), x1 = beatToX(ch.start + ch.length - clipAbs);
      if (x1 < KEYS_W || x0 > W) continue;
      const pcs = chordPitchClasses(ch);
      for (let i = 0; i < rows; i++) {
        const p = topPitch - i;
        if (pcs.includes(pc(p))) { g.fillStyle = 'rgba(61,198,255,0.06)'; g.fillRect(Math.max(KEYS_W, x0), i * rowH, x1 - Math.max(KEYS_W, x0), rowH); }
      }
      g.fillStyle = '#5aa9cc'; g.font = '10px sans-serif';
      if (x0 >= KEYS_W) g.fillText(ch.symbol, x0 + 3, 10);
    }
    // vertical grid
    const b0 = xToBeat(KEYS_W), b1 = xToBeat(W);
    const bpb = (project.timeSignature.numerator * 4) / project.timeSignature.denominator;
    const step = gridBeats * zoomX < 6 ? 1 : gridBeats;
    for (let b = Math.floor(b0 / step) * step; b <= b1; b += step) {
      const x = beatToX(b);
      const absB = b + clipAbs;
      g.fillStyle = Math.abs(absB / bpb - Math.round(absB / bpb)) < 1e-6 ? '#353b48' : Math.abs(absB - Math.round(absB)) < 1e-6 ? '#262a33' : '#1d2028';
      g.fillRect(Math.round(x), 0, 1, gridH);
    }
    // loop end / clip end
    const endX = beatToX(clip.loop ? clip.contentLength : clip.offset + clip.length);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(Math.max(KEYS_W, endX), 0, W, gridH);
    g.fillStyle = '#ff8a3d'; g.fillRect(endX, 0, 1, gridH);
    // notes
    const selSet = new Set(sel);
    g.font = '9px sans-serif';
    for (const n of clip.notes) {
      const x = beatToX(n.start), w = Math.max(2, n.duration * zoomX - 1), y = pitchToY(n.pitch);
      if (x + w < KEYS_W || x > W || y + rowH < 0 || y > gridH) continue;
      const s = selSet.has(n.id);
      g.fillStyle = s ? '#ffffff' : track.color;
      g.globalAlpha = 0.55 + 0.45 * n.velocity;
      g.fillRect(x, y + 1, w, rowH - 2);
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + w - 2, y + 1, 2, rowH - 2);
      if (rowH >= 10 && w > 24) { g.fillStyle = '#000a'; g.fillText(n.lyric ? n.lyric : noteName(n.pitch), x + 3, y + rowH - 3); }
    }
    // box selection
    const d = dragRef.current;
    if (d?.kind === 'box') {
      g.strokeStyle = '#3dc6ff'; g.setLineDash([4, 3]);
      const x0 = beatToX(Math.min(d.b0, d.b1)), x1 = beatToX(Math.max(d.b0, d.b1));
      const y0 = pitchToY(Math.max(d.p0, d.p1)), y1 = pitchToY(Math.min(d.p0, d.p1)) + rowH;
      g.strokeRect(x0, y0, x1 - x0, y1 - y0); g.setLineDash([]);
    }
    // keyboard
    for (let i = 0; i < rows; i++) {
      const p = topPitch - i;
      if (p < 0) break;
      const y = i * rowH;
      g.fillStyle = isBlack(p) ? '#20232a' : '#d9dce3';
      g.fillRect(0, y, KEYS_W - 2, rowH - 0.5);
      if (p % 12 === 0 || rowH >= 14) { g.fillStyle = isBlack(p) ? '#a6adbb' : '#2b2f3a'; g.font = '9px monospace'; g.fillText(noteName(p), 3, y + rowH - 3); }
    }
    // velocity lane
    g.fillStyle = '#0b0c0f'; g.fillRect(0, gridH, W, VEL_H);
    g.fillStyle = '#2b2f3a'; g.fillRect(0, gridH, W, 1);
    g.fillStyle = '#6f7686'; g.font = '9px sans-serif'; g.fillText('VELOCITY', 4, gridH + 12);
    for (const n of clip.notes) {
      const x = beatToX(n.start);
      if (x < KEYS_W || x > W) continue;
      const h = (VEL_H - 8) * n.velocity;
      g.fillStyle = selSet.has(n.id) ? '#fff' : track.color;
      g.fillRect(x, gridH + VEL_H - h - 2, 3, h);
    }
  }, [clip, size, scrollX, zoomX, rowH, topPitch, sel, key, project.chords, project.timeSignature, gridBeats, track.color]);

  useEffect(() => { draw(); }, [draw]);

  // playhead overlay
  const phRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const b = (engine.playing ? engine.positionBeat() : useStudio.getState().cursorBeat) - (clip.start - clip.offset);
      const x = beatToX(b);
      if (phRef.current) { phRef.current.style.transform = `translateX(${x}px)`; phRef.current.style.display = x >= KEYS_W && x <= size.w ? 'block' : 'none'; }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  });

  const preview = (pitch: number, vel = 0.8) => {
    engine.previewNoteOff(voiceRef.current);
    voiceRef.current = engine.previewNoteOn(track.id, pitch, vel);
  };
  const stopPreview = () => { engine.previewNoteOff(voiceRef.current); voiceRef.current = null; };

  const fitPitch = (p: number) => (scaleSnap ? snapToScale(p, key.tonic, key.mode) : p);

  const onPointerDown = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    (e.target as Element).setPointerCapture(e.pointerId);
    if (x < KEYS_W && y < gridH) { preview(yToPitch(y)); return; }
    if (y >= gridH) {
      // velocity edit
      useStudio.getState().beginGesture();
      dragRef.current = { kind: 'vel' };
      const setVel = (cx: number, cy: number) => {
        const b = xToBeat(cx), v = Math.max(0.02, Math.min(1, (gridH + VEL_H - 2 - cy) / (VEL_H - 8)));
        const tol = 4 / zoomX;
        updateNotes((ns) => ns.map((n) => (Math.abs(n.start - b) < tol || (sel.includes(n.id) && sel.length > 1 && e.shiftKey) ? { ...n, velocity: v } : n)));
      };
      setVel(x, y);
      return;
    }
    const hit = noteAt(x, y);
    const b = xToBeat(x), p = yToPitch(y);
    const st = useStudio.getState();
    if (tool === 'erase' || e.button === 2) {
      if (hit) updateNotes((ns) => ns.filter((n) => n.id !== hit.n.id), 'Delete note');
      return;
    }
    if (hit) {
      const ids = e.shiftKey ? [...new Set([...sel, hit.n.id])] : sel.includes(hit.n.id) ? sel : [hit.n.id];
      setSel(ids);
      st.beginGesture();
      if (e.altKey) {
        // alt-drag duplicates the selection
        const dups = clip.notes.filter((n) => ids.includes(n.id)).map((n) => ({ ...n, id: uid('n') }));
        updateNotes((ns) => [...ns, ...dups]);
        setSel(dups.map((d) => d.id));
        dragRef.current = { kind: 'move', startBeat: b, startPitch: p, base: dups, ids: dups.map((d) => d.id) };
      } else if (hit.edge) dragRef.current = { kind: 'resize', startBeat: b, base: clip.notes.filter((n) => ids.includes(n.id)), ids };
      else dragRef.current = { kind: 'move', startBeat: b, startPitch: p, base: clip.notes.filter((n) => ids.includes(n.id)), ids };
      preview(hit.n.pitch, hit.n.velocity);
      return;
    }
    if (tool === 'select') {
      setSel([]);
      dragRef.current = { kind: 'box', b0: b, p0: p, b1: b, p1: p };
      return;
    }
    // draw / chord
    const start = Math.max(0, Math.floor(b / gridBeats) * gridBeats * (snapOn ? 1 : 0) + (snapOn ? 0 : b));
    const pitch = fitPitch(p);
    if (tool === 'chord') {
      let pitches: number[];
      if (chordQ === 'diatonic') {
        const deg = degreeOf(snapToScale(pitch, key.tonic, key.mode), key.tonic, key.mode);
        const ch = diatonicChord(key.tonic, key.mode, Math.max(0, deg), 3);
        pitches = chordPitchClasses(ch).map((pcx, i) => { let n = pitch - pc(pitch - pcx); if (i === 0) n = snapToScale(pitch, key.tonic, key.mode); while (i > 0 && n <= pitch) n += 12; return n; });
      } else pitches = CHORD_QUALITIES[chordQ].intervals.map((iv) => pitch + iv);
      const notes = pitches.map((pp) => newNote(pp, start, lastLen, 0.8));
      updateNotes((ns) => [...ns, ...notes], 'Add chord');
      setSel(notes.map((n) => n.id));
      pitches.forEach((pp) => engine.previewNote(track.id, pp, 0.7, 0.4));
      return;
    }
    const n = newNote(pitch, start, lastLen, 0.8);
    st.beginGesture();
    updateNotes((ns) => [...ns, n]);
    setSel([n.id]);
    dragRef.current = { kind: 'draw', id: n.id, start };
    preview(pitch);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const r = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const c = canvasRef.current!;
    if (!d) {
      const hit = y < gridH && x > KEYS_W ? noteAt(x, y) : null;
      c.style.cursor = hit?.edge ? 'ew-resize' : hit ? 'grab' : x < KEYS_W ? 'pointer' : tool === 'erase' ? 'not-allowed' : tool === 'select' ? 'default' : 'crosshair';
      return;
    }
    const b = xToBeat(x), p = yToPitch(y);
    if (d.kind === 'vel') {
      const v = Math.max(0.02, Math.min(1, (gridH + VEL_H - 2 - y) / (VEL_H - 8)));
      const tol = 4 / zoomX;
      updateNotes((ns) => ns.map((n) => (Math.abs(n.start - b) < tol ? { ...n, velocity: v } : n)));
    } else if (d.kind === 'move') {
      const db = snapB(b - d.startBeat), dp = p - d.startPitch;
      const map = new Map(d.base.map((n) => [n.id, n]));
      updateNotes((ns) => ns.map((n) => { const o = map.get(n.id); return o ? { ...n, start: Math.max(0, o.start + db), pitch: Math.max(0, Math.min(127, fitPitch(o.pitch + dp))) } : n; }));
      if (dp !== 0 && d.base[0]) { const np = fitPitch(d.base[0].pitch + dp); if (np !== voiceRef.current?.pitch) preview(np); }
    } else if (d.kind === 'resize') {
      const db = b - d.startBeat;
      const map = new Map(d.base.map((n) => [n.id, n]));
      updateNotes((ns) => ns.map((n) => { const o = map.get(n.id); if (!o) return n; const endB = snapOn ? Math.round((o.start + o.duration + db) / gridBeats) * gridBeats : o.start + o.duration + db; return { ...n, duration: Math.max(gridBeats / 4, endB - o.start) }; }));
    } else if (d.kind === 'draw') {
      const endB = snapOn ? Math.ceil(b / gridBeats) * gridBeats : b;
      const len = Math.max(snapOn ? gridBeats : 1 / 32, endB - d.start);
      updateNotes((ns) => ns.map((n) => (n.id === d.id ? { ...n, duration: len } : n)));
    } else if (d.kind === 'box') {
      d.b1 = b; d.p1 = p;
      const lo = Math.min(d.b0, d.b1), hi = Math.max(d.b0, d.b1), pl = Math.min(d.p0, d.p1), ph = Math.max(d.p0, d.p1);
      setSel(clip.notes.filter((n) => n.start + n.duration > lo && n.start < hi && n.pitch >= pl && n.pitch <= ph).map((n) => n.id));
      force((x) => x + 1);
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    stopPreview();
    const st = useStudio.getState();
    if (!d) return;
    if (d.kind === 'draw') {
      const n = useStudio.getState().project.tracks.find((t) => t.id === track.id)?.clips.find((c) => c.id === clip.id)?.notes.find((x) => x.id === d.id);
      if (n) setLastLen(n.duration);
      st.endGesture('Draw note');
    } else if (d.kind === 'move') st.endGesture('Move notes');
    else if (d.kind === 'resize') { st.endGesture('Resize notes'); }
    else if (d.kind === 'vel') st.endGesture('Edit velocity');
    force((x) => x + 1);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) { setZoomX((z) => Math.max(8, Math.min(600, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))); return; }
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) setScrollX((s) => Math.max(0, s + (e.deltaX || e.deltaY)));
    else setTopPitch((t) => Math.max(Math.ceil(gridH / rowH), Math.min(127, t - Math.sign(e.deltaY) * 3)));
  };

  // keyboard shortcuts while the editor is focused
  const onKeyDown = (e: React.KeyboardEvent) => {
    const has = sel.length > 0;
    const selected = (fn: (ns: Note[]) => Note[]) => (ns: Note[]) => { const inSel = ns.filter((n) => sel.includes(n.id)); return [...ns.filter((n) => !sel.includes(n.id)), ...fn(inSel)]; };
    if ((e.key === 'Delete' || e.key === 'Backspace') && has) { updateNotes((ns) => ns.filter((n) => !sel.includes(n.id)), 'Delete notes'); setSel([]); }
    else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) setSel(clip.notes.map((n) => n.id));
    else if (e.key === 'c' && (e.ctrlKey || e.metaKey) && has) useStudio.getState().set({ clipboard: { kind: 'notes', data: clip.notes.filter((n) => sel.includes(n.id)) } });
    else if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
      const cb = useStudio.getState().clipboard;
      if (cb?.kind === 'notes') {
        const src = cb.data as Note[];
        const min = Math.min(...src.map((n) => n.start));
        const at = Math.max(0, useStudio.getState().cursorBeat - (clip.start - clip.offset));
        const pasted = src.map((n) => ({ ...n, id: uid('n'), start: at + n.start - min }));
        updateNotes((ns) => [...ns, ...pasted], 'Paste notes');
        setSel(pasted.map((n) => n.id));
      }
    } else if (e.key === 'd' && (e.ctrlKey || e.metaKey) && has) {
      const src = clip.notes.filter((n) => sel.includes(n.id));
      const span = Math.max(...src.map((n) => n.start + n.duration)) - Math.min(...src.map((n) => n.start));
      const dups = src.map((n) => ({ ...n, id: uid('n'), start: n.start + Math.ceil(span / gridBeats) * gridBeats }));
      updateNotes((ns) => [...ns, ...dups], 'Duplicate notes'); setSel(dups.map((d) => d.id));
    } else if (e.key === 'ArrowUp' && has) updateNotes(selected((ns) => transposeNotes(ns, e.shiftKey ? 12 : 1)), 'Transpose');
    else if (e.key === 'ArrowDown' && has) updateNotes(selected((ns) => transposeNotes(ns, e.shiftKey ? -12 : -1)), 'Transpose');
    else if (e.key === 'ArrowRight' && has) updateNotes(selected((ns) => ns.map((n) => ({ ...n, start: n.start + gridBeats }))), 'Nudge');
    else if (e.key === 'ArrowLeft' && has) updateNotes(selected((ns) => ns.map((n) => ({ ...n, start: Math.max(0, n.start - gridBeats) }))), 'Nudge');
    else if (e.key === 'q') updateNotes(target((ns) => quantizeNotes(ns, gridBeats, qStrength)), 'Quantize');
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  // apply to selection or all
  const target = (fn: (ns: Note[]) => Note[]) => (ns: Note[]) => {
    if (!sel.length) return fn(ns);
    const inSel = ns.filter((n) => sel.includes(n.id));
    return [...ns.filter((n) => !sel.includes(n.id)), ...fn(inSel)];
  };
  const op = (label: string, fn: (ns: Note[]) => Note[]) => updateNotes(target(fn), label);
  const setClip = (patch: Partial<Clip>, label: string) => useStudio.getState().commit(label, (p) => ({ ...p, tracks: p.tracks.map((t) => (t.id !== track.id ? t : { ...t, clips: t.clips.map((c) => (c.id === clip.id ? { ...c, ...patch } : c)) })) }));

  const selInfo = useMemo(() => {
    const ns = clip.notes.filter((n) => sel.includes(n.id));
    if (!ns.length) return `${clip.notes.length} notes`;
    return `${ns.length} selected · vel ${Math.round((ns.reduce((a, n) => a + n.velocity, 0) / ns.length) * 127)}`;
  }, [clip.notes, sel]);

  return (
    <div className="editor" tabIndex={0} onKeyDown={onKeyDown} style={{ outline: 'none' }}>
      <div className="editor-toolbar">
        <b style={{ color: track.color }}>{track.name}</b><span className="dim small">· {clip.name}</span>
        <div className="sep" />
        {(['draw', 'select', 'erase', 'chord'] as const).map((t) => <button key={t} className={`btn sm ${tool === t ? 'on' : ''}`} onClick={() => setTool(t)}>{{ draw: '✎ Draw', select: '↖ Select', erase: '⌫ Erase', chord: '♫ Chord' }[t]}</button>)}
        {tool === 'chord' && (
          <select className="input" style={{ height: 22 }} value={chordQ} onChange={(e) => setChordQ(e.target.value)}>
            <option value="diatonic">Diatonic triad</option>
            {Object.keys(CHORD_QUALITIES).map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        )}
        <label className="row small" title="Snap drawn/moved notes to the project scale"><input type="checkbox" checked={scaleSnap} onChange={(e) => setScaleSnap(e.target.checked)} />Scale snap</label>
        <div className="sep" />
        <button className="btn sm" title="Quantize to grid (Q)" onClick={() => op('Quantize', (ns) => quantizeNotes(ns, gridBeats, qStrength))}>Quantize</button>
        <input type="range" min={0.1} max={1} step={0.05} value={qStrength} onChange={(e) => setQStrength(Number(e.target.value))} title={`Quantize strength ${Math.round(qStrength * 100)}%`} style={{ width: 50 }} />
        <button className="btn sm" title="Transpose −1 semitone (↓)" onClick={() => op('Transpose', (ns) => transposeNotes(ns, -1))}>−1</button>
        <button className="btn sm" title="Transpose +1 semitone (↑)" onClick={() => op('Transpose', (ns) => transposeNotes(ns, 1))}>+1</button>
        <button className="btn sm" title="Octave down (Shift+↓)" onClick={() => op('Octave down', (ns) => transposeNotes(ns, -12))}>−Oct</button>
        <button className="btn sm" title="Octave up (Shift+↑)" onClick={() => op('Octave up', (ns) => transposeNotes(ns, 12))}>+Oct</button>
        <button className="btn sm" onClick={() => op('Humanize', (ns) => humanizeNotes(ns, 0.6, Date.now() % 1e6))}>Humanize</button>
        <button className="btn sm" onClick={() => op('Legato', legato)}>Legato</button>
        <button className="btn sm" onClick={() => op('Velocity −', (ns) => scaleVelocities(ns, 0.85))}>Vel−</button>
        <button className="btn sm" onClick={() => op('Velocity +', (ns) => scaleVelocities(ns, 1.15))}>Vel+</button>
        <button className="btn sm" onClick={() => op('Remove duplicates', dedupeNotes)}>Dedupe</button>
        <label className="row small" title="Swing (delays off-beat 16ths)">Swing<input type="range" min={0} max={1} step={0.05} value={clip.swing} style={{ width: 60 }} onChange={(e) => setClip({ swing: Number(e.target.value) }, 'Swing')} /></label>
        <label className="row small"><input type="checkbox" checked={clip.loop} onChange={(e) => setClip({ loop: e.target.checked, contentLength: e.target.checked ? clip.length : clip.contentLength }, 'Clip loop')} />Loop</label>
        <div className="grow" />
        <span className="dim small">{selInfo}</span>
        <button className="btn sm" title="Zoom" onClick={() => setRowH((h) => (h >= 18 ? 9 : h + 3))}>↕</button>
      </div>
      <div className="editor-body" ref={wrapRef} onWheel={onWheel}>
        <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onContextMenu={(e) => e.preventDefault()} />
        <div ref={phRef} className="playhead" style={{ left: 0, height: size.h }} />
      </div>
    </div>
  );
}
