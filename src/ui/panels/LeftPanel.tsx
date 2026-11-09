import { useEffect, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { EFFECT_DEFS, EFFECT_PRESETS, makeEffect } from '../../model/effects';
import { instrumentFromPreset, PRESETS } from '../../model/presets';
import type { EffectType } from '../../model/schema';
import { deleteAsset, listAssets, storageEstimate, type StoredAsset } from '../../storage/db';
import * as A from '../../state/actions';
import { useStudio, type LeftTab } from '../../state/store';

function Instruments() {
  const [q, setQ] = useState('');
  const sel = useStudio((s) => s.selectedTrackIds[0]);
  const cats = [...new Set(PRESETS.map((p) => p.category))];
  const filt = PRESETS.filter((p) => !q || `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="col" style={{ gap: 0, minHeight: 0, flex: 1 }}>
      <div style={{ padding: 8 }}><input className="input" style={{ width: '100%' }} placeholder="Search instruments…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="notice small" style={{ margin: '0 8px 8px' }}>All built-in instruments are <b>synthesized</b> in your browser. For realistic acoustic sounds, create a <b>Sampler</b> track and import samples you own.</div>
      <div className="list scroll" style={{ flex: 1 }}>
        {cats.map((c) => {
          const items = filt.filter((p) => p.category === c);
          if (!items.length) return null;
          return (
            <div key={c}>
              <div className="cat-head">{c}</div>
              {items.map((p) => (
                <div key={p.id} className="list-item" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-aims-preset', p.id)} title={`${p.description}\nClick ▶ to audition · drag onto a track · “+” adds a track`}>
                  <button className="btn sm ghost" onClick={() => void engine.audition(instrumentFromPreset(p.id), p.kind === 'drumkit' ? 36 : Math.round((p.range[0] + p.range[1]) / 2))}>▶</button>
                  <span className="title">{p.name}</span>
                  {sel && <button className="btn sm ghost" title="Use on selected track" onClick={() => A.setInstrumentPreset(sel, p.id)}>⇄</button>}
                  <button className="btn sm ghost" title="New track with this instrument" onClick={() => A.addTrack(p.kind === 'drumkit' ? 'drums' : 'instrument', p.id)}>+</button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Samples() {
  const [assets, setAssets] = useState<Omit<StoredAsset, 'bytes'>[]>([]);
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const instRef = useRef<HTMLInputElement>(null);
  const midiRef = useRef<HTMLInputElement>(null);
  const refresh = async () => { setAssets(await listAssets().catch(() => [])); setEst(await storageEstimate()); };
  useEffect(() => { void refresh(); const f = () => void refresh(); engine.assets.listeners.add(f); return () => { engine.assets.listeners.delete(f); }; }, []);
  const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
  return (
    <div className="col" style={{ padding: 8, minHeight: 0, flex: 1 }}>
      <input ref={audioRef} type="file" accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.webm" multiple hidden onChange={(e) => { if (e.target.files) void A.importFiles(e.target.files); e.target.value = ''; }} />
      <input ref={instRef} type="file" accept="audio/*" multiple hidden onChange={(e) => { if (e.target.files) void A.importInstrumentSamples(e.target.files); e.target.value = ''; }} />
      <input ref={midiRef} type="file" accept=".mid,.midi,audio/midi" multiple hidden onChange={(e) => { if (e.target.files) void A.importFiles(e.target.files); e.target.value = ''; }} />
      <button className="btn" onClick={() => audioRef.current?.click()}>Import audio (WAV, MP3, …)</button>
      <button className="btn" onClick={() => instRef.current?.click()}>Build sampled instrument…</button>
      <button className="btn" onClick={() => midiRef.current?.click()}>Import MIDI file…</button>
      <div className="dim small">Formats are decoded by your browser: WAV always works; MP3/OGG/AAC/FLAC depend on the browser. Unsupported files are reported, not silently ignored.</div>
      <div className="section-title">Stored audio ({assets.length})</div>
      <div className="list scroll" style={{ flex: 1 }}>
        {assets.map((a) => (
          <div key={a.id} className="list-item" title={`${a.kind} · ${mb(a.size)}`}>
            <span className="badge">{a.kind}</span>
            <span className="title">{a.name}</span>
            <span className="dim small">{a.durationSec.toFixed(1)}s</span>
            <button className="btn sm ghost" title="Add to arrangement at cursor" onClick={async () => { await engine.assets.ensure([a.id]); const b = engine.assets.get(a.id); if (b) A.addAudioClipToNewTrack(a.id, b, useStudio.getState().cursorBeat, a.name); }}>+</button>
            <button className="btn sm ghost" title="Delete from browser storage" onClick={async () => { if (confirm(`Delete "${a.name}" from browser storage? Clips using it will become silent.`)) { await deleteAsset(a.id); void refresh(); } }}>✕</button>
          </div>
        ))}
      </div>
      {est && <div className="dim small">Browser storage: {mb(est.usage)} used of ~{mb(est.quota)}</div>}
    </div>
  );
}

function Effects() {
  const sel = useStudio((s) => s.selectedTrackIds[0]);
  const tname = useStudio((s) => s.project.tracks.find((t) => t.id === sel)?.name);
  const add = (type: EffectType, params = {}, master = false) => useStudio.getState().commit(`Add ${EFFECT_DEFS[type].name}`, (p) => {
    const fx = makeEffect(type, params);
    if (type === 'ducking') fx.params.source = p.tracks.find((t) => t.role === 'drums')?.id ?? '';
    if (master || !sel) {
      const li = p.master.effects.findIndex((e) => e.type === 'limiter');
      const list = li >= 0 && type !== 'limiter' ? [...p.master.effects.slice(0, li), fx, ...p.master.effects.slice(li)] : [...p.master.effects, fx];
      return { ...p, master: { ...p.master, effects: list } };
    }
    return { ...p, tracks: p.tracks.map((t) => (t.id === sel ? { ...t, effects: [...t.effects, fx] } : t)) };
  });
  return (
    <div className="list scroll" style={{ flex: 1 }}>
      <div className="notice small" style={{ margin: 8 }}>Click to insert on <b>{tname ?? 'Master'}</b>. Shift-click inserts on Master.</div>
      <div className="cat-head">Processors</div>
      {Object.values(EFFECT_DEFS).map((d) => <div key={d.type} className="list-item" title={d.description} onClick={(e) => add(d.type, {}, e.shiftKey)}><span className="title">{d.name}</span></div>)}
      <div className="cat-head">Presets</div>
      {EFFECT_PRESETS.map((p) => <div key={p.name} className="list-item" onClick={(e) => add(p.type, p.params, e.shiftKey)}><span className="title">{p.name}</span><span className="dim small">{EFFECT_DEFS[p.type].name}</span></div>)}
    </div>
  );
}

function Projects() {
  const recent = useStudio((s) => s.recent);
  const cur = useStudio((s) => s.project.id);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { void useStudio.getState().refreshRecent(); }, []);
  return (
    <div className="col" style={{ padding: 8, minHeight: 0, flex: 1 }}>
      <input ref={fileRef} type="file" accept=".json,.aims" hidden onChange={(e) => { if (e.target.files) void A.importFiles(e.target.files); e.target.value = ''; }} />
      <div className="row wrap">
        <button className="btn" onClick={() => void A.newEmptyProject('empty')}>New</button>
        <button className="btn" onClick={() => void A.duplicateProject()}>Duplicate</button>
        <button className="btn" onClick={() => A.exportProjectFile()}>Export file</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>Import file</button>
      </div>
      <div className="section-title">Templates</div>
      <div className="row wrap">
        {(['beat', 'band', 'orchestra', 'podcast'] as const).map((t) => <button key={t} className="chip" onClick={() => void A.newEmptyProject(t)}>{t}</button>)}
      </div>
      <div className="section-title">Recent projects (this browser)</div>
      <div className="list scroll" style={{ flex: 1 }}>
        {recent.map((r) => (
          <div key={r.id} className="list-item" style={r.id === cur ? { background: 'var(--bg2)' } : undefined} onClick={() => r.id !== cur && void A.openProject(r.id)}>
            <span className="title">{r.name}</span>
            <span className="dim small">{new Date(r.updatedAt).toLocaleDateString()}</span>
            {r.id !== cur && <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete project "${r.name}"?`)) void A.removeProject(r.id); }}>✕</button>}
          </div>
        ))}
        {!recent.length && <div className="dim small" style={{ padding: 8 }}>No saved projects yet. Your work autosaves here.</div>}
      </div>
      <div className="dim small">Projects autosave to this browser (IndexedDB). Export a project file to back up or move it; audio recordings stay in browser storage.</div>
    </div>
  );
}

export function LeftPanel() {
  const tab = useStudio((s) => s.leftTab);
  const set = useStudio((s) => s.set);
  const tabs: [LeftTab, string][] = [['instruments', 'Instruments'], ['samples', 'Samples'], ['effects', 'Effects'], ['projects', 'Projects']];
  return (
    <>
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => set({ leftTab: k })}>{l}</button>)}</div>
      {tab === 'instruments' && <Instruments />}
      {tab === 'samples' && <Samples />}
      {tab === 'effects' && <Effects />}
      {tab === 'projects' && <Projects />}
    </>
  );
}
