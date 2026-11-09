import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { waveformPeaks } from '../../export/analysis';
import { duplicateClip, splitClip, trimClipEnd, trimClipStart } from '../../model/clipOps';
import { newMidiClip, projectEndBeat, TRACK_COLORS } from '../../model/factory';
import { PRESET_MAP } from '../../model/presets';
import type { Clip, Project, Track } from '../../model/schema';
import { MeterMap } from '../../model/tempo';
import { uid } from '../../util/id';
import * as A from '../../state/actions';
import { useStudio } from '../../state/store';
import { useContextMenu } from './widgets';

const RULER_H = 58;
const GRIDS: [string, number][] = [['Bar', 0], ['1/2', 2], ['1/4', 1], ['1/8', 0.5], ['1/16', 0.25], ['1/32', 0.125], ['1/4T', 2 / 3], ['1/8T', 1 / 3], ['1/16T', 1 / 6]];

function useAssetVersion() {
  const [v, setV] = useState(0);
  useEffect(() => { const f = () => setV((x) => x + 1); engine.assets.listeners.add(f); return () => { engine.assets.listeners.delete(f); }; }, []);
  return v;
}

const ClipView = memo(function ClipView({ clip, track, zoom, height, selected, assetV }: { clip: Clip; track: Track; zoom: number; height: number; selected: boolean; assetV: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = Math.max(2, clip.length * zoom);
  const h = height - 4;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = Math.min(8000, Math.ceil(w)), H = h;
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    const top = 13;
    if (clip.kind === 'midi' && clip.notes.length) {
      const pitches = clip.notes.map((n) => n.pitch);
      const lo = Math.min(...pitches), hi = Math.max(...pitches);
      const span = Math.max(12, hi - lo + 1);
      const rows = H - top - 2;
      const reps = clip.loop ? Math.ceil((clip.offset + clip.length) / clip.contentLength) + 1 : 1;
      for (let r = 0; r < reps; r++) for (const n of clip.notes) {
        if (clip.loop && n.start >= clip.contentLength) continue;
        const x = (n.start + r * clip.contentLength - clip.offset) * zoom;
        if (x > W || x + n.duration * zoom < 0) continue;
        const y = top + rows - ((n.pitch - lo + 1) / span) * rows;
        g.globalAlpha = 0.45 + 0.55 * n.velocity;
        g.fillRect(x, y, Math.max(1.5, n.duration * zoom - 1), Math.max(1.5, rows / span - 0.5));
      }
      g.globalAlpha = 1;
    } else if (clip.kind === 'audio' && clip.audio) {
      const buf = engine.assets.get(clip.audio.assetId);
      if (buf) {
        const bpm = useStudio.getState().project.bpm;
        const spb = 60 / bpm;
        const startS = clip.audio.startSec + clip.offset * spb * clip.audio.playbackRate;
        const durS = clip.length * spb * clip.audio.playbackRate;
        const s0 = Math.floor(startS * buf.sampleRate), s1 = Math.min(buf.length, Math.floor((startS + durS) * buf.sampleRate));
        const visW = Math.min(W, Math.ceil(((s1 - s0) / buf.sampleRate / clip.audio.playbackRate / spb) * zoom));
        if (s1 > s0 && visW > 0) {
          const pk = waveformPeaks(buf, visW, s0, s1);
          const mid = top + (H - top) / 2, amp = (H - top) / 2 - 1;
          g.beginPath();
          for (let i = 0; i < visW; i++) { g.moveTo(i + 0.5, mid + pk[i * 2] * amp); g.lineTo(i + 0.5, mid + pk[i * 2 + 1] * amp + 0.5); }
          g.strokeStyle = 'rgba(0,0,0,0.65)';
          g.stroke();
        }
      } else {
        g.font = '10px sans-serif';
        g.fillText(engine.assets.missing.has(clip.audio.assetId) ? 'audio missing' : 'loading…', 6, H - 6);
      }
    }
  }, [clip, zoom, w, h, assetV]);
  const loops = clip.loop ? Array.from({ length: Math.ceil((clip.offset + clip.length) / clip.contentLength) }, (_, i) => (i + 1) * clip.contentLength - clip.offset).filter((x) => x > 0 && x < clip.length) : [];
  return (
    <div className={`clip ${selected ? 'selected' : ''} ${clip.muted ? 'muted' : ''}`} data-clip={clip.id} data-track={track.id}
      style={{ left: clip.start * zoom, width: w, background: clip.color ?? track.color }}>
      <div className="clip-label">{clip.loop ? '⟳ ' : ''}{clip.name}</div>
      <canvas ref={ref} style={{ width: Math.min(8000, Math.ceil(w)), height: h }} />
      {loops.map((x) => <div key={x} className="loopmark" style={{ left: x * zoom }} />)}
      <div className="handle l" data-handle="l" />
      <div className="handle r" data-handle="r" title="Drag to trim · Shift+drag to loop" />
    </div>
  );
});

function TrackHeader({ t, index, selected }: { t: Track; index: number; selected: boolean }) {
  const commit = useStudio((s) => s.commit);
  const set = useStudio((s) => s.set);
  const menu = useContextMenu();
  const preset = PRESET_MAP[t.instrument.preset];
  const upd = (patch: Partial<Track>, label: string) => commit(label, (p) => ({ ...p, tracks: p.tracks.map((x) => (x.id === t.id ? { ...x, ...patch } : x)) }));
  const group = useStudio((s) => s.project.groups.find((g) => g.id === t.groupId));
  return (
    <div className={`track-head ${selected ? 'sel' : ''}`} style={{ height: t.height }}
      onPointerDown={(e) => {
        const s = useStudio.getState();
        set({ selectedTrackIds: e.ctrlKey || e.metaKey ? (s.selectedTrackIds.includes(t.id) ? s.selectedTrackIds.filter((x) => x !== t.id) : [...s.selectedTrackIds, t.id]) : [t.id] });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        menu.open(e, [
          { label: 'Duplicate track', onClick: () => A.duplicateTrack(t.id) },
          { label: 'Delete track', onClick: () => A.deleteTracks([t.id]) },
          { label: 'Group selected tracks', onClick: () => A.groupTracks(useStudio.getState().selectedTrackIds) },
          { label: t.groupId ? 'Remove from group' : 'Ungrouped', onClick: () => upd({ groupId: null }, 'Ungroup'), disabled: !t.groupId },
          { label: 'Next colour', onClick: () => upd({ color: TRACK_COLORS[(TRACK_COLORS.indexOf(t.color) + 1) % TRACK_COLORS.length] }, 'Track colour') },
          { label: t.height > 70 ? 'Smaller' : 'Taller', onClick: () => upd({ height: t.height > 70 ? 56 : 110 }, 'Track height') },
          { label: 'Export track as MIDI', onClick: () => A.exportMidi([t.id]), disabled: t.type === 'audio' },
        ]);
      }}>
      <div className="color" style={{ background: t.color }} />
      <div className="row" style={{ gap: 4 }}>
        <input className="name" value={t.name} aria-label="Track name" onChange={(e) => useStudio.getState().live((p) => ({ ...p, tracks: p.tracks.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)) }))} onBlur={() => commit('Rename track', (p) => ({ ...p }))} />
      </div>
      <div className="ctrls">
        <button className={`ms m ${t.mute ? 'on' : ''}`} title="Mute" onClick={(e) => { e.stopPropagation(); upd({ mute: !t.mute }, 'Mute'); }}>M</button>
        <button className={`ms s ${t.solo ? 'on' : ''}`} title="Solo" onClick={(e) => { e.stopPropagation(); upd({ solo: !t.solo }, 'Solo'); }}>S</button>
        {t.type === 'audio' && <button className={`ms r ${t.armed ? 'on' : ''}`} title="Arm for recording" onClick={(e) => { e.stopPropagation(); commit('Arm', (p) => ({ ...p, tracks: p.tracks.map((x) => ({ ...x, armed: x.id === t.id ? !t.armed : false })) })); }}>R</button>}
        <input type="range" min={-60} max={6} step={0.5} value={t.volume} style={{ width: 60 }} title={`Volume ${t.volume} dB`}
          onPointerDown={() => useStudio.getState().beginGesture()} onPointerUp={() => useStudio.getState().endGesture('Volume')}
          onChange={(e) => useStudio.getState().live((p) => ({ ...p, tracks: p.tracks.map((x) => (x.id === t.id ? { ...x, volume: Number(e.target.value) } : x)) }))} />
        <span className={`badge ${t.instrument.source === 'sampled' ? 'sampled' : 'synth'}`} title={preset?.description ?? (t.type === 'audio' ? 'Audio track' : '')} style={{ maxWidth: 70, overflow: 'hidden' }}>
          {t.type === 'audio' ? 'audio' : t.instrument.source === 'sampled' ? 'sampled' : 'synth'}
        </span>
      </div>
      {t.height > 60 && <div className="dim small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{index + 1}. {t.type === 'audio' ? 'Audio' : preset?.name ?? t.instrument.preset}{group ? ` · ${group.name}` : ''}</div>}
      {menu.node}
    </div>
  );
}

export function Timeline() {
  const project = useStudio((s) => s.project);
  const zoom = useStudio((s) => s.zoom);
  const snapOn = useStudio((s) => s.snap);
  const grid = useStudio((s) => s.grid);
  const tool = useStudio((s) => s.tool);
  const selection = useStudio((s) => s.selection);
  const selClips = useStudio((s) => s.selectedClipIds);
  const selTracks = useStudio((s) => s.selectedTrackIds);
  const set = useStudio((s) => s.set);
  const assetV = useAssetVersion();
  const lanesRef = useRef<HTMLDivElement>(null);
  const headersRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const rulerHeadRef = useRef<HTMLDivElement>(null);
  const [scrollX, setScrollX] = useState(0);
  const [viewW, setViewW] = useState(1000);
  const [dragOver, setDragOver] = useState(false);
  const menu = useContextMenu();
  const meter = useMemo(() => MeterMap.fromProject(project), [project.timeSignature, project.signatureChanges]);
  const bpb = meter.segs[0].beatsPerBar;
  const gridBeats = grid === 0 ? bpb : grid;
  const snap = useCallback((b: number) => (snapOn ? Math.round(b / gridBeats) * gridBeats : b), [snapOn, gridBeats]);
  const end = Math.max(projectEndBeat(project) + bpb * 16, bpb * 64);
  const contentW = end * zoom;
  const trackTops = useMemo(() => {
    const tops: number[] = [];
    let y = 0;
    for (const t of project.tracks) { tops.push(y); y += t.height; }
    return { tops, total: y };
  }, [project.tracks]);

  // ---- ruler drawing ----
  useLayoutEffect(() => {
    const c = rulerRef.current;
    if (!c) return;
    const W = viewW, H = RULER_H, dpr = devicePixelRatio;
    c.width = W * dpr; c.height = H * dpr;
    c.style.width = `${W}px`; c.style.height = `${H}px`;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.fillStyle = '#14161b'; g.fillRect(0, 0, W, H);
    const from = scrollX / zoom, to = (scrollX + W) / zoom;
    // sections row
    for (const s of project.sections) {
      const x = s.start * zoom - scrollX, w = s.length * zoom;
      if (x > W || x + w < 0) continue;
      const hue = { intro: 210, verse: 160, prechorus: 50, chorus: 20, drop: 0, climax: 350, bridge: 280, breakdown: 240, buildup: 40, outro: 210, theme: 180, development: 300, solo: 120, coda: 210 }[s.kind as string] ?? 200;
      g.fillStyle = `hsla(${hue}, 60%, ${20 + s.energy * 18}%, 1)`;
      g.fillRect(x + 1, 1, w - 2, 16);
      g.fillStyle = '#e7e9ee'; g.font = '600 10px sans-serif';
      g.save(); g.beginPath(); g.rect(x, 0, w, 18); g.clip();
      g.fillText(`${s.name}${s.transpose ? ` (${s.transpose > 0 ? '+' : ''}${s.transpose})` : ''}`, x + 5, 12);
      g.restore();
    }
    // bars
    g.font = '10px monospace';
    const labelEvery = zoom * bpb < 24 ? 8 : zoom * bpb < 50 ? 4 : zoom * bpb < 90 ? 2 : 1;
    for (const b of meter.bars(Math.max(0, from - bpb), to + bpb)) {
      const x = b.beat * zoom - scrollX;
      g.fillStyle = '#3a4050'; g.fillRect(x, 18, 1, 18);
      if (b.bar % labelEvery === 0) { g.fillStyle = '#a6adbb'; g.fillText(String(b.bar + 1), x + 3, 30); }
      if (zoom * b.seg.beatsPerBar > 40) for (let k = 1; k < b.seg.numerator; k++) { const bx = x + ((k * 4) / b.seg.denominator) * zoom; g.fillStyle = '#2b2f3a'; g.fillRect(bx, 28, 1, 8); }
    }
    // markers
    for (const m of project.markers) { const x = m.beat * zoom - scrollX; g.fillStyle = m.color; g.beginPath(); g.moveTo(x, 18); g.lineTo(x + 6, 18); g.lineTo(x, 26); g.fill(); g.fillText(m.name, x + 8, 26); }
    // loop
    if (project.loop.end > project.loop.start) {
      const x = project.loop.start * zoom - scrollX, w = (project.loop.end - project.loop.start) * zoom;
      g.fillStyle = project.loop.enabled ? '#ff8a3d66' : '#ffffff1a';
      g.fillRect(x, 36, w, 7);
    }
    // chords
    g.font = '10px sans-serif';
    for (const ch of project.chords) {
      const x = ch.start * zoom - scrollX, w = ch.length * zoom;
      if (x > W || x + w < 0) continue;
      g.fillStyle = '#1b1e25'; g.fillRect(x + 1, 44, w - 2, 13);
      if (w > 18) { g.fillStyle = '#9fd8ff'; g.save(); g.beginPath(); g.rect(x, 44, w - 2, 13); g.clip(); g.fillText(ch.symbol, x + 3, 54); g.restore(); }
    }
    if (selection) { g.fillStyle = '#3dc6ff33'; g.fillRect(selection.from * zoom - scrollX, 18, (selection.to - selection.from) * zoom, 18); }
  }, [project.sections, project.markers, project.loop, project.chords, zoom, scrollX, viewW, meter, bpb, selection]);

  // ---- playhead animation & follow ----
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const beat = engine.playing ? engine.positionBeat() : useStudio.getState().cursorBeat;
      const x = beat * useStudio.getState().zoom;
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
      const l = lanesRef.current;
      if (engine.playing && l && (x > l.scrollLeft + l.clientWidth - 40 || x < l.scrollLeft)) l.scrollLeft = Math.max(0, x - 80);
      if (rulerHeadRef.current && l) rulerHeadRef.current.style.transform = `translateX(${x - l.scrollLeft}px)`;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const l = lanesRef.current;
    if (!l) return;
    const ro = new ResizeObserver(() => setViewW(l.clientWidth));
    ro.observe(l);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const l = lanesRef.current!;
    setScrollX(l.scrollLeft);
    if (headersRef.current) headersRef.current.scrollTop = l.scrollTop;
  };

  // ctrl+wheel zoom around pointer
  useEffect(() => {
    const l = lanesRef.current;
    if (!l) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const z = useStudio.getState().zoom;
      const rect = l.getBoundingClientRect();
      const beat = (e.clientX - rect.left + l.scrollLeft) / z;
      const nz = Math.max(3, Math.min(400, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      useStudio.setState({ zoom: nz });
      requestAnimationFrame(() => { l.scrollLeft = beat * nz - (e.clientX - rect.left); });
    };
    l.addEventListener('wheel', wheel, { passive: false });
    return () => l.removeEventListener('wheel', wheel);
  }, []);

  const posFromEvent = (e: { clientX: number; clientY: number }) => {
    const l = lanesRef.current!;
    const r = l.getBoundingClientRect();
    const x = e.clientX - r.left + l.scrollLeft;
    const y = e.clientY - r.top + l.scrollTop;
    let ti = trackTops.tops.findIndex((top, i) => y >= top && y < top + project.tracks[i].height);
    if (ti < 0 && y >= trackTops.total) ti = -1;
    return { beat: Math.max(0, x / zoom), trackIndex: ti };
  };

  // ---- pointer interactions on lanes ----
  const onLanePointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const target = e.target as HTMLElement;
    const clipEl = target.closest('[data-clip]') as HTMLElement | null;
    const { beat, trackIndex } = posFromEvent(e);
    const st = useStudio.getState();
    if (clipEl) {
      const clipId = clipEl.dataset.clip!;
      const trackId = clipEl.dataset.track!;
      const track = project.tracks.find((t) => t.id === trackId)!;
      const clip = track.clips.find((c) => c.id === clipId)!;
      if (tool === 'erase') { st.commit('Delete clip', (p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t)) })); return; }
      if (tool === 'split' || e.altKey && !e.shiftKey && target.dataset.handle === undefined && e.detail === 1 && (e.metaKey || false)) { A.splitAt(snap(beat), [clipId]); return; }
      const handle = target.dataset.handle as 'l' | 'r' | undefined;
      const sel = e.shiftKey ? (st.selectedClipIds.includes(clipId) ? st.selectedClipIds : [...st.selectedClipIds, clipId]) : st.selectedClipIds.includes(clipId) ? st.selectedClipIds : [clipId];
      set({ selectedClipIds: sel, selectedTrackIds: [trackId], editClipId: track.type === 'audio' ? st.editClipId : clipId });
      const startX = e.clientX, startY = e.clientY;
      const dup = e.ctrlKey || e.metaKey || e.altKey;
      st.beginGesture();
      const base = st.project;
      const origin = snap(beat) - beat;
      let moved = false;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const dxBeats = (ev.clientX - startX) / zoom;
        if (!moved && Math.abs(ev.clientX - startX) < 3 && Math.abs(ev.clientY - startY) < 3) return;
        moved = true;
        if (handle) {
          st.live(() => ({
            ...base,
            tracks: base.tracks.map((t) => (t.id !== trackId ? t : {
              ...t, clips: t.clips.map((c) => {
                if (c.id !== clipId) return c;
                if (handle === 'l') return trimClipStart(c, snap(c.start + dxBeats));
                const newEnd = snap(c.start + c.length + dxBeats);
                if (ev.shiftKey) return { ...c, loop: true, contentLength: c.loop ? c.contentLength : c.length, length: Math.max(1 / 16, newEnd - c.start) };
                return trimClipEnd(c, newEnd);
              }),
            })),
          }));
        } else {
          const { trackIndex: ti } = posFromEvent(ev);
          const trackDelta = ti >= 0 ? ti - project.tracks.findIndex((t) => t.id === trackId) : 0;
          const d = snap(clip.start + dxBeats + origin) - clip.start;
          st.live(() => moveClips(base, sel, d, trackDelta, dup));
        }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (moved) st.endGesture(handle ? 'Trim clip' : dup ? 'Duplicate clip' : 'Move clip');
        else st.cancelGesture();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    // empty area
    const track = project.tracks[trackIndex];
    if (tool === 'draw' && track && track.type !== 'audio') {
      const s = Math.floor(beat / bpb) * bpb;
      const clip = newMidiClip(s, bpb, [], track.name);
      st.commit('New clip', (p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === track.id ? { ...t, clips: [...t.clips, clip] } : t)) }));
      set({ selectedClipIds: [clip.id], editClipId: clip.id, bottomTab: 'editor' });
      return;
    }
    set({ selectedClipIds: [], selectedTrackIds: track ? [track.id] : st.selectedTrackIds, cursorBeat: snap(beat), selection: null });
    if (!engine.playing) set({ cursorBeat: snap(beat) });
    const b0 = snap(beat);
    const move = (ev: PointerEvent) => {
      const { beat: b } = posFromEvent(ev);
      const b1 = snap(b);
      if (Math.abs(b1 - b0) > 1e-6) set({ selection: { from: Math.min(b0, b1), to: Math.max(b0, b1) } });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onRulerPointerDown = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - r.top;
    const beatAt = (cx: number) => Math.max(0, (cx - r.left + scrollX) / zoom);
    const b0 = snap(beatAt(e.clientX));
    const st = useStudio.getState();
    if (y >= 36 && y < 44) {
      // loop region drag
      st.beginGesture();
      const move = (ev: PointerEvent) => { const b1 = snap(beatAt(ev.clientX)); if (Math.abs(b1 - b0) > 0) st.live((p) => ({ ...p, loop: { enabled: true, start: Math.min(b0, b1), end: Math.max(b0, b1) } })); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); st.endGesture('Set loop'); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    if (y < 18) {
      const s = project.sections.find((x) => b0 >= x.start && b0 < x.start + x.length);
      if (s) { set({ selection: { from: s.start, to: s.start + s.length } }); return; }
    }
    A.seek(b0);
  };

  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    const clipEl = (e.target as HTMLElement).closest('[data-clip]') as HTMLElement | null;
    const { beat } = posFromEvent(e);
    if (clipEl) {
      const clipId = clipEl.dataset.clip!, trackId = clipEl.dataset.track!;
      const st = useStudio.getState();
      if (!st.selectedClipIds.includes(clipId)) set({ selectedClipIds: [clipId] });
      const t = project.tracks.find((x) => x.id === trackId)!;
      const c = t.clips.find((x) => x.id === clipId)!;
      const upd = (fn: (c: Clip) => Clip, label: string) => st.commit(label, (p) => ({ ...p, tracks: p.tracks.map((tt) => (tt.id === trackId ? { ...tt, clips: tt.clips.map((cc) => (cc.id === clipId ? fn(cc) : cc)) } : tt)) }));
      menu.open(e, [
        { label: 'Open in editor', onClick: () => set({ editClipId: clipId, bottomTab: 'editor' }) },
        { label: 'Split here', onClick: () => A.splitAt(snap(beat), [clipId]) },
        { label: 'Duplicate', onClick: () => A.duplicateSelectedClips() },
        { label: c.loop ? 'Disable looping' : 'Enable looping', onClick: () => upd((x) => ({ ...x, loop: !x.loop, contentLength: x.loop ? x.contentLength : x.length }), 'Toggle clip loop') },
        { label: c.muted ? 'Unmute clip' : 'Mute clip', onClick: () => upd((x) => ({ ...x, muted: !x.muted }), 'Mute clip') },
        { label: 'Rename…', onClick: () => { const n = prompt('Clip name', c.name); if (n) upd((x) => ({ ...x, name: n }), 'Rename clip'); } },
        { label: 'Copy', onClick: () => A.copySelection() },
        { label: 'Delete', onClick: () => A.deleteSelectedClips() },
      ]);
    } else {
      menu.open(e, [
        { label: 'Paste at cursor', onClick: () => A.pasteAtCursor(), disabled: !useStudio.getState().clipboard },
        { label: 'Add marker here', onClick: () => { const n = prompt('Marker name', 'Marker'); if (n) useStudio.getState().commit('Add marker', (p) => ({ ...p, markers: [...p.markers, { id: uid('m'), beat: snap(beat), name: n, color: '#3dc6ff' }] })); } },
        { label: 'Tempo change here…', onClick: () => { const v = Number(prompt('New BPM from this point', String(project.bpm))); if (v > 20 && v < 400) useStudio.getState().commit('Tempo change', (p) => ({ ...p, tempoChanges: [...p.tempoChanges.filter((t) => Math.abs(t.beat - snap(beat)) > 1e-6), { beat: snap(beat), bpm: v }] })); } },
        { label: 'Time signature change here…', onClick: () => { const v = prompt('Time signature from this bar (e.g. 3/4)', '3/4'); const m = v && /^(\d+)\/(2|4|8|16)$/.exec(v.trim()); if (m) useStudio.getState().commit('Time signature change', (p) => ({ ...p, signatureChanges: [...p.signatureChanges, { beat: snap(beat), numerator: Number(m[1]), denominator: Number(m[2]) as 4 }] })); } },
        { label: 'Set loop to selection', onClick: () => { const s = useStudio.getState().selection; if (s) useStudio.getState().commit('Set loop', (p) => ({ ...p, loop: { enabled: true, start: s.from, end: s.to } })); }, disabled: !selection },
      ]);
    }
  };

  // grid background
  const gridStyle = useMemo(() => {
    const barW = bpb * zoom;
    const beatW = zoom;
    return {
      backgroundImage: `linear-gradient(90deg, #262a33 1px, transparent 1px), linear-gradient(90deg, #1a1d24 1px, transparent 1px)`,
      backgroundSize: `${barW}px 100%, ${beatW}px 100%`,
    };
  }, [zoom, bpb]);

  return (
    <div className="center">
      <div className="tl-toolbar">
        {(['select', 'draw', 'erase', 'split'] as const).map((t) => (
          <button key={t} className={`btn sm ${tool === t ? 'on' : ''}`} onClick={() => set({ tool: t })} title={{ select: 'Select / move / trim (V)', draw: 'Draw clips (B)', erase: 'Erase (E)', split: 'Split (S)' }[t]}>{{ select: '↖ Select', draw: '✎ Draw', erase: '⌫ Erase', split: '✂ Split' }[t]}</button>
        ))}
        <div className="sep" />
        <label className="row small"><input type="checkbox" checked={snapOn} onChange={(e) => set({ snap: e.target.checked })} />Snap</label>
        <select className="input" style={{ height: 22 }} value={String(grid)} onChange={(e) => set({ grid: Number(e.target.value) })} aria-label="Grid">
          {GRIDS.map(([n, v]) => <option key={n} value={String(v)}>{n}</option>)}
        </select>
        <div className="sep" />
        <button className="btn sm" title="Zoom out" onClick={() => set({ zoom: Math.max(3, zoom / 1.3) })}>−</button>
        <button className="btn sm" title="Zoom in" onClick={() => set({ zoom: Math.min(400, zoom * 1.3) })}>+</button>
        <button className="btn sm" title="Zoom to fit" onClick={() => { const l = lanesRef.current; if (l) set({ zoom: Math.max(3, (l.clientWidth - 40) / Math.max(bpb * 8, projectEndBeat(project))) }); }}>Fit</button>
        <div className="sep" />
        <button className="btn sm" onClick={() => A.addTrack('instrument')}>+ Instrument</button>
        <button className="btn sm" onClick={() => A.addTrack('drums')}>+ Drums</button>
        <button className="btn sm" onClick={() => A.addTrack('audio')}>+ Audio</button>
        <button className="btn sm" onClick={() => A.addTrack('sampler')} title="Sampler track for your own instrument samples">+ Sampler</button>
        <div className="grow" />
        {selection && <span className="badge" title="Selection (AI actions apply here)">Sel: bar {meter.beatToBar(selection.from).bar + 1}–{meter.beatToBar(selection.to - 1e-6).bar + 1}<button className="btn ghost sm" onClick={() => set({ selection: null })}>✕</button></span>}
        <span className="dim small hide-sm">Drag empty space = select range · Ctrl+drag clip = copy · Shift+drag right edge = loop · Ctrl+wheel = zoom</span>
      </div>
      <div className="timeline" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          const { beat, trackIndex } = posFromEvent(e);
          if (e.dataTransfer.files.length) void A.importFiles(e.dataTransfer.files, project.tracks[trackIndex]?.id, snap(beat));
          const preset = e.dataTransfer.getData('application/x-aims-preset');
          if (preset) { const t = project.tracks[trackIndex]; if (t && t.type !== 'audio') A.setInstrumentPreset(t.id, preset); else A.addTrack(PRESET_MAP[preset]?.kind === 'drumkit' ? 'drums' : 'instrument', preset); }
        }}>
        <div className="tl-corner"><span className="dim small">{project.tracks.length} tracks</span></div>
        <div className="ruler" style={{ height: RULER_H }} onPointerDown={onRulerPointerDown} title="Click: move playhead · drag bottom strip: loop region · click section: select it">
          <canvas ref={rulerRef} />
          <div ref={rulerHeadRef} className="playhead" style={{ left: 0 }} />
        </div>
        <div className="headers" ref={headersRef}>
          {project.tracks.map((t, i) => <TrackHeader key={t.id} t={t} index={i} selected={selTracks.includes(t.id)} />)}
          <div style={{ height: 200 }} />
        </div>
        <div className="lanes" ref={lanesRef} onScroll={onScroll} onPointerDown={onLanePointerDown} onContextMenu={onContext}
          onDoubleClick={(e) => { const el = (e.target as HTMLElement).closest('[data-clip]') as HTMLElement | null; if (el) set({ editClipId: el.dataset.clip!, bottomTab: 'editor', panels: { ...useStudio.getState().panels, bottomOpen: true } }); }}>
          <div className="lanes-inner" style={{ width: contentW, height: Math.max(trackTops.total + 200, 300), ...gridStyle }}>
            {project.tracks.map((t, i) => (
              <div key={t.id} className={`lane ${selTracks.includes(t.id) ? 'sel' : ''}`} style={{ top: trackTops.tops[i], height: t.height }}>
                {t.clips.map((c) => {
                  const x0 = c.start * zoom, x1 = x0 + c.length * zoom;
                  if (x1 < scrollX - 400 || x0 > scrollX + viewW + 400) return null;
                  return <ClipView key={c.id} clip={c} track={t} zoom={zoom} height={t.height} selected={selClips.includes(c.id)} assetV={assetV} />;
                })}
              </div>
            ))}
            {selection && <div className="sel-range" style={{ left: selection.from * zoom, width: (selection.to - selection.from) * zoom }} />}
            <div ref={playheadRef} className="playhead" style={{ left: 0 }} />
            {!project.tracks.length && (
              <div className="empty-state" style={{ position: 'absolute', left: scrollX, width: viewW, top: 40 }}>
                <div className="col" style={{ alignItems: 'center' }}>
                  <div style={{ fontSize: 18, color: 'var(--text2)' }}>Your arrangement is empty</div>
                  <div>Describe a song in the AI panel → <b>Generate Music</b>, add tracks above, or drop audio / MIDI files here.</div>
                </div>
              </div>
            )}
          </div>
        </div>
        {dragOver && <div className="drop-hint">Drop audio, MIDI or project files</div>}
      </div>
      {menu.node}
    </div>
  );
}

function moveClips(p: Project, ids: string[], delta: number, trackDelta: number, duplicate: boolean): Project {
  const moving: { from: number; clip: Clip }[] = [];
  p.tracks.forEach((t, ti) => t.clips.forEach((c) => { if (ids.includes(c.id)) moving.push({ from: ti, clip: c }); }));
  const tracks = p.tracks.map((t) => ({ ...t, clips: duplicate ? [...t.clips] : t.clips.filter((c) => !ids.includes(c.id)) }));
  for (const m of moving) {
    let ti = Math.max(0, Math.min(tracks.length - 1, m.from + trackDelta));
    // audio clips only land on audio tracks and vice versa
    if ((tracks[ti].type === 'audio') !== (m.clip.kind === 'audio')) ti = m.from;
    const c = duplicate ? duplicateClip(m.clip, Math.max(0, m.clip.start + delta)) : { ...m.clip, start: Math.max(0, m.clip.start + delta) };
    tracks[ti].clips.push(c);
  }
  return { ...p, tracks };
}

export { splitClip };
