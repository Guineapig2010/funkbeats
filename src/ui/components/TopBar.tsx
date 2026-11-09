import { useEffect, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { MeterMap, TempoMap, formatBarsBeats, formatTime } from '../../model/tempo';
import { keyLabel, NOTE_NAMES } from '../../theory/theory';
import { saveNow, useStudio } from '../../state/store';
import { stop, togglePlay, toggleRecord } from '../../state/actions';
import { Meter } from './widgets';
import { ModeSchema } from '../../model/schema';

function PositionDisplay() {
  const ref1 = useRef<HTMLSpanElement>(null);
  const ref2 = useRef<HTMLSpanElement>(null);
  const project = useStudio((s) => s.project);
  useEffect(() => {
    const tm = TempoMap.fromProject(project), mm = MeterMap.fromProject(project);
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const beat = engine.playing ? engine.positionBeat() : useStudio.getState().cursorBeat;
      if (ref1.current) ref1.current.textContent = formatBarsBeats(beat, mm);
      if (ref2.current) ref2.current.textContent = formatTime(tm.beatToSec(beat));
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [project]);
  return <div className="lcd" title="Position (bar.beat.ticks) and time"><span ref={ref1} className="big">1.1.00</span><span ref={ref2} className="sm">0:00.00</span></div>;
}

export function TopBar({ onExport }: { onExport: () => void }) {
  const project = useStudio((s) => s.project);
  const playing = useStudio((s) => s.playing);
  const recording = useStudio((s) => s.recording);
  const saveState = useStudio((s) => s.saveState);
  const mode = useStudio((s) => s.mode);
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  const commit = useStudio((s) => s.commit);
  const set = useStudio((s) => s.set);
  const [bpm, setBpm] = useState(String(project.bpm));
  useEffect(() => setBpm(String(project.bpm)), [project.bpm]);
  const [cpu, setCpu] = useState(engine.cpuInfo());
  useEffect(() => { const id = setInterval(() => setCpu(engine.cpuInfo()), 1000); return () => clearInterval(id); }, []);
  const applyBpm = () => {
    const v = Math.max(20, Math.min(400, Number(bpm) || project.bpm));
    if (v !== project.bpm) commit('Change tempo', (p) => ({ ...p, bpm: v, tempoChanges: p.tempoChanges.map((t) => ({ ...t, bpm: Math.round(t.bpm * (v / p.bpm) * 10) / 10 })) }));
    setBpm(String(v));
  };
  return (
    <div className="topbar">
      <div className="brand"><div className="brand-logo">AI</div><span className="hide-sm">AIMS Studio</span></div>
      <input className="input hide-sm" style={{ width: 170, fontWeight: 600 }} value={project.name} aria-label="Project name"
        onChange={(e) => useStudio.getState().live((p) => ({ ...p, name: e.target.value }))} onBlur={() => commit('Rename', (p) => ({ ...p }))} />
      <div className="sep" />
      <button className="btn icon" title="Stop / return to start (Enter)" onClick={() => stop(true)}>■</button>
      <button className={`btn icon ${playing ? 'on' : ''}`} title="Play / Pause (Space)" onClick={() => void togglePlay()}>{playing ? '❚❚' : '▶'}</button>
      <button className={`btn icon rec ${recording ? 'on' : ''}`} title="Record on armed track (R)" onClick={() => void toggleRecord()}>●</button>
      <button className={`btn icon ${project.loop.enabled ? 'on' : ''}`} title="Loop region (L)" onClick={() => commit('Toggle loop', (p) => ({ ...p, loop: { ...p.loop, enabled: !p.loop.enabled } }))}>⟳</button>
      <button className={`btn icon ${project.metronome.enabled ? 'on' : ''}`} title="Metronome (M)" onClick={() => commit('Toggle metronome', (p) => ({ ...p, metronome: { ...p.metronome, enabled: !p.metronome.enabled } }))}>♩</button>
      <PositionDisplay />
      <label className="row small muted" title="Tempo (BPM)">BPM
        <input className="input num" value={bpm} onChange={(e) => setBpm(e.target.value)} onBlur={applyBpm} onKeyDown={(e) => { if (e.key === 'Enter') applyBpm(); }} aria-label="Tempo" />
      </label>
      <select className="input" value={`${project.timeSignature.numerator}/${project.timeSignature.denominator}`} title="Time signature" aria-label="Time signature"
        onChange={(e) => { const [n, d] = e.target.value.split('/').map(Number); commit('Time signature', (p) => ({ ...p, timeSignature: { numerator: n, denominator: d as 4 } })); }}>
        {['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '9/8', '12/8'].map((x) => <option key={x}>{x}</option>)}
      </select>
      <select className="input hide-sm" title="Project key (used for scale highlighting & composition)" value={`${project.key.tonic}|${project.key.mode}`} aria-label="Key"
        onChange={(e) => { const [t, m] = e.target.value.split('|'); commit('Key', (p) => ({ ...p, key: { tonic: Number(t), mode: m as typeof p.key.mode } })); }}>
        {NOTE_NAMES.flatMap((_, t) => ['major', 'minor', 'dorian', 'mixolydian', 'phrygian', 'lydian', 'harmonicMinor'].map((m) => <option key={`${t}|${m}`} value={`${t}|${m}`}>{keyLabel(t, ModeSchema.parse(m))}</option>))}
      </select>
      <div className="sep" />
      <button className="btn icon" disabled={!canUndo} title="Undo (Ctrl+Z)" onClick={() => useStudio.getState().undo()}>↶</button>
      <button className="btn icon" disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" onClick={() => useStudio.getState().redo()}>↷</button>
      <button className="btn" title="Save to browser storage (Ctrl+S) — autosave is on" onClick={() => void saveNow()}>
        Save <span className={`badge ${saveState.status === 'error' ? 'bad' : saveState.status === 'saved' ? 'good' : ''}`}>{saveState.status === 'saving' ? '…' : saveState.status === 'saved' ? '✓' : saveState.status === 'error' ? '!' : '·'}</span>
      </button>
      <button className="btn primary" onClick={onExport} title="Export WAV / MP3 / stems / MIDI / project">Export</button>
      <div className="grow" />
      <span className="badge hide-sm" title="Audio engine status">{cpu.state === 'running' ? `${(cpu.sampleRate / 1000).toFixed(1)} kHz · ${cpu.voices} voices · ${cpu.latency.toFixed(0)} ms` : 'audio idle – click Play'}</span>
      <Meter read={() => engine.readMaster()} width={14} height={34} />
      <button className="btn" onClick={() => set({ mode: mode === 'studio' ? 'beginner' : 'studio' })} title="Switch between the simple AI screen and the full studio">{mode === 'studio' ? '✦ Simple mode' : '⚙ Studio'}</button>
    </div>
  );
}
