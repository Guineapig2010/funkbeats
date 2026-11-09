import { useEffect, useMemo, useState } from 'react';
import { engine } from '../audio/engine';
import * as A from '../state/actions';
import { saveNow, useStudio, type BottomTab } from '../state/store';
import { requestPersistence } from '../storage/db';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import { Splitter, Toasts } from './components/widgets';
import { AutomationEditor } from './editors/Automation';
import { DrumEditor } from './editors/DrumEditor';
import { InstrumentEditor } from './editors/InstrumentEditor';
import { MasterPanel } from './editors/MasterPanel';
import { Mixer } from './editors/Mixer';
import { PianoRoll } from './editors/PianoRoll';
import { VocalsPanel } from './editors/Vocals';
import { AIPanel, ChatPanel } from './panels/AIPanel';
import { Beginner } from './panels/Beginner';
import { ExportDialog } from './panels/ExportDialog';
import { LeftPanel } from './panels/LeftPanel';

function ClipEditor() {
  const editId = useStudio((s) => s.editClipId);
  const tracks = useStudio((s) => s.project.tracks);
  const found = useMemo(() => {
    for (const t of tracks) { const c = t.clips.find((x) => x.id === editId); if (c) return { t, c }; }
    return null;
  }, [tracks, editId]);
  const [forcePiano, setForcePiano] = useState(false);
  if (!found) return <div className="empty-state">Double-click a MIDI or drum clip in the timeline to edit it here.<br />Use the Draw tool (✎) on a track to create an empty clip.</div>;
  if (found.c.kind === 'audio') return <div className="empty-state">Audio clips are edited on the timeline (move, trim, split, loop). Fades, gain and playback rate are in the clip context menu → see Mixer/Vocals for processing.</div>;
  const drums = found.t.instrument.kind === 'drumkit';
  return (
    <div className="editor">
      {drums && <div className="row" style={{ padding: '2px 8px' }}><button className={`btn sm ${!forcePiano ? 'on' : ''}`} onClick={() => setForcePiano(false)}>Step sequencer</button><button className={`btn sm ${forcePiano ? 'on' : ''}`} onClick={() => setForcePiano(true)}>Piano roll</button></div>}
      {drums && !forcePiano ? <DrumEditor key={found.c.id} clip={found.c} track={found.t} /> : <PianoRoll key={found.c.id} clip={found.c} track={found.t} />}
    </div>
  );
}

function ProjectWarnings() {
  const p = useStudio((s) => s.project);
  const w = useMemo(() => {
    const notes = p.tracks.reduce((a, t) => a + t.clips.reduce((b, c) => b + c.notes.length, 0), 0);
    const out: string[] = [];
    if (p.tracks.length > 48) out.push(`${p.tracks.length} tracks`);
    if (notes > 40000) out.push(`${notes.toLocaleString()} notes`);
    return out;
  }, [p.tracks]);
  if (!w.length) return null;
  return <div className="notice warn small" style={{ margin: 4 }}>Large project ({w.join(', ')}): playback may stutter on slower devices. Freeze ideas by exporting stems, or mute unused tracks.</div>;
}

export function App() {
  const mode = useStudio((s) => s.mode);
  const panels = useStudio((s) => s.panels);
  const bottomTab = useStudio((s) => s.bottomTab);
  const rightTab = useStudio((s) => s.rightTab);
  const busy = useStudio((s) => s.busy);
  const set = useStudio((s) => s.set);
  const [exporting, setExporting] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const restored = await A.restoreLastSession();
      if (!restored) set({ mode: 'beginner' });
      engine.setProject(useStudio.getState().project);
      void useStudio.getState().refreshRecent();
      void requestPersistence();
      setReady(true);
    })();
    // resume audio on first gesture (autoplay policy)
    const unlock = () => { void engine.start(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const unsub = engine.onStateChange.add(() => useStudio.setState({ playing: engine.playing }));
    void unsub;
  }, [set]);

  // global shortcuts
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (el.closest('.editor[tabindex]') && ['Delete', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const st = useStudio.getState();
      const mod = e.ctrlKey || e.metaKey;
      const keyboardOpen = st.bottomTab === 'instrument' && st.panels.bottomOpen;
      if (e.code === 'Space') { e.preventDefault(); void A.togglePlay(); }
      else if (e.key === 'Enter') A.stop(true);
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); st.redo(); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void saveNow().then((ok) => ok && st.toast('success', 'Saved')); }
      else if (mod && e.key.toLowerCase() === 'c') A.copySelection();
      else if (mod && e.key.toLowerCase() === 'v') A.pasteAtCursor();
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); A.duplicateSelectedClips(); }
      else if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); setExporting(true); }
      else if (e.key === 'Delete' || e.key === 'Backspace') A.deleteSelectedClips();
      else if (keyboardOpen) return; // letters play the on-screen keyboard
      else if (e.key.toLowerCase() === 'r' && !mod) void A.toggleRecord();
      else if (e.key.toLowerCase() === 'l' && !mod) st.commit('Toggle loop', (p) => ({ ...p, loop: { ...p.loop, enabled: !p.loop.enabled } }));
      else if (e.key.toLowerCase() === 'm' && !mod) st.commit('Toggle metronome', (p) => ({ ...p, metronome: { ...p.metronome, enabled: !p.metronome.enabled } }));
      else if (e.key.toLowerCase() === 'v' && !mod) st.set({ tool: 'select' });
      else if (e.key.toLowerCase() === 'b' && !mod) st.set({ tool: 'draw' });
      else if (e.key.toLowerCase() === 'e' && !mod) st.set({ tool: 'erase' });
      else if (e.key.toLowerCase() === 's' && !mod) { if (st.selectedClipIds.length) A.splitAt(engine.playing ? engine.positionBeat() : st.cursorBeat); else st.set({ tool: 'split' }); }
      else if (e.key === 'Home') A.seek(0);
      else if (e.key === 'Escape') st.set({ selection: null, selectedClipIds: [] });
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const resize = (key: 'left' | 'right' | 'bottom', d: number, min: number, max: number) => {
    const p = useStudio.getState().panels;
    set({ panels: { ...p, [key]: Math.max(min, Math.min(max, p[key] + d)) } });
  };
  const tabs: [BottomTab, string][] = [['editor', 'Piano Roll / Drums'], ['mixer', 'Mixer'], ['instrument', 'Instrument & FX'], ['automation', 'Automation'], ['vocals', 'Vocals & Lyrics'], ['master', 'Master & Analysis']];

  if (!ready) return <div className="empty-state" style={{ height: '100%' }}>Loading AIMS Studio…</div>;
  if (mode === 'beginner') return <div className="app" style={{ position: 'relative' }}><Beginner /><Toasts /></div>;
  return (
    <div className="app">
      <TopBar onExport={() => setExporting(true)} />
      {busy && <div className="busy-bar" style={{ position: 'absolute', top: 48, left: 0, right: 0, zIndex: 30 }} />}
      <div className="main" style={{ position: 'relative' }}>
        {panels.leftOpen ? (
          <>
            <div className="panel left" style={{ width: panels.left }}>
              <LeftPanel />
              <button className="btn ghost sm" style={{ margin: 4 }} onClick={() => set({ panels: { ...panels, leftOpen: false } })}>« Hide browser</button>
            </div>
            <Splitter dir="v" onDrag={(d) => resize('left', d, 180, 480)} />
          </>
        ) : <div className="collapsed-rail"><span className="rail-label" onClick={() => set({ panels: { ...panels, leftOpen: true } })}>Browser »</span></div>}
        <div className="center">
          <ProjectWarnings />
          <Timeline />
          {panels.bottomOpen && <Splitter dir="h" onDrag={(d) => resize('bottom', -d, 120, 700)} />}
          <div className="bottom" style={{ height: panels.bottomOpen ? panels.bottom : 34 }}>
            <div className="tabs">
              {tabs.map(([k, l]) => <button key={k} className={`tab ${bottomTab === k && panels.bottomOpen ? 'on' : ''}`} onClick={() => set({ bottomTab: k, panels: { ...panels, bottomOpen: true } })}>{l}</button>)}
              <span className="grow" />
              <button className="tab" onClick={() => set({ panels: { ...panels, bottomOpen: !panels.bottomOpen } })}>{panels.bottomOpen ? '▾ Hide' : '▴ Show'}</button>
            </div>
            {panels.bottomOpen && (
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                {bottomTab === 'editor' && <ClipEditor />}
                {bottomTab === 'mixer' && <Mixer />}
                {bottomTab === 'instrument' && <InstrumentEditor />}
                {bottomTab === 'automation' && <AutomationEditor />}
                {bottomTab === 'vocals' && <VocalsPanel />}
                {bottomTab === 'master' && <MasterPanel />}
              </div>
            )}
          </div>
        </div>
        {panels.rightOpen ? (
          <>
            <Splitter dir="v" onDrag={(d) => resize('right', -d, 280, 640)} />
            <div className="panel right" style={{ width: panels.right }}>
              <div className="tabs">
                <button className={`tab ${rightTab === 'generate' ? 'on' : ''}`} onClick={() => set({ rightTab: 'generate' })}>✦ AI Generator</button>
                <button className={`tab ${rightTab === 'chat' ? 'on' : ''}`} onClick={() => set({ rightTab: 'chat' })}>Assistant</button>
                <span className="grow" />
                <button className="tab" title="Collapse" onClick={() => set({ panels: { ...panels, rightOpen: false } })}>»</button>
              </div>
              {rightTab === 'generate' ? <AIPanel /> : <ChatPanel />}
            </div>
          </>
        ) : <div className="collapsed-rail"><span className="rail-label" onClick={() => set({ panels: { ...panels, rightOpen: true } })}>« AI Generator & Assistant</span></div>}
      </div>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      <Toasts />
    </div>
  );
}
