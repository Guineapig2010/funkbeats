import { useEffect, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import type { Voice } from '../../audio/instruments/synths';
import { DRUM_PIECES, PRESETS, PRESET_MAP } from '../../model/presets';
import type { SynthParams, Track, Wave } from '../../model/schema';
import { noteName, parseNoteName } from '../../theory/theory';
import { useStudio } from '../../state/store';
import { importInstrumentSamples, replaceDrumSample, setInstrumentPreset } from '../../state/actions';
import { Knob, fmtDb, fmtHz } from '../components/widgets';
import { EffectsRack } from './EffectsRack';

const WAVES: Wave[] = ['sine', 'triangle', 'sawtooth', 'square'];
const KEYMAP = 'awsedftgyhujkolp;'; // computer keyboard → semitones from C

/** Playable on-screen keyboard (mouse/touch + computer keys A–; ). */
export function Keyboard({ trackId, low = 48, octaves = 3 }: { trackId: string | null; low?: number; octaves?: number }) {
  const [down, setDown] = useState<Set<number>>(new Set());
  const voices = useRef(new Map<number, Voice | null>());
  const [oct, setOct] = useState(0);
  const on = (p: number) => { if (!trackId || voices.current.has(p)) return; voices.current.set(p, engine.previewNoteOn(trackId, p, 0.8)); setDown((s) => new Set(s).add(p)); };
  const off = (p: number) => { engine.previewNoteOff(voices.current.get(p) ?? null); voices.current.delete(p); setDown((s) => { const n = new Set(s); n.delete(p); return n; }); };
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]') || e.ctrlKey || e.metaKey || e.repeat) return;
      if (e.key === 'z') return setOct((o) => o - 1);
      if (e.key === 'x') return setOct((o) => o + 1);
      const i = KEYMAP.indexOf(e.key.toLowerCase());
      if (i >= 0) { on(60 + oct * 12 + i); e.stopPropagation(); }
    };
    const ku = (e: KeyboardEvent) => { const i = KEYMAP.indexOf(e.key.toLowerCase()); if (i >= 0) off(60 + oct * 12 + i); };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  });
  const whites: number[] = [];
  for (let p = low; p < low + octaves * 12 + 1; p++) if (![1, 3, 6, 8, 10].includes(p % 12)) whites.push(p);
  const W = 22;
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row small muted">Keyboard {trackId ? '' : '(select a track)'} · computer keys A–; play C{4 + oct}… · Z/X octave</div>
      <div style={{ position: 'relative', height: 70, width: whites.length * W, userSelect: 'none', touchAction: 'none' }}>
        {whites.map((p, i) => (
          <div key={p} onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); on(p); }} onPointerUp={() => off(p)} onPointerLeave={() => off(p)}
            style={{ position: 'absolute', left: i * W, width: W - 1, height: 70, background: down.has(p) ? '#ff8a3d' : '#e7e9ee', borderRadius: '0 0 4px 4px', cursor: 'pointer', fontSize: 9, color: '#333', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>{p % 12 === 0 ? noteName(p) : ''}</div>
        ))}
        {whites.map((p, i) => [1, 3, 6, 8, 10].includes((p + 1) % 12) && p + 1 < low + octaves * 12 ? (
          <div key={p + 1} onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); on(p + 1); }} onPointerUp={() => off(p + 1)} onPointerLeave={() => off(p + 1)}
            style={{ position: 'absolute', left: i * W + W * 0.65, width: W * 0.7, height: 44, background: down.has(p + 1) ? '#ff8a3d' : '#1b1e25', borderRadius: '0 0 3px 3px', cursor: 'pointer', zIndex: 2 }} />
        ) : null)}
      </div>
    </div>
  );
}

function SynthControls({ t }: { t: Track }) {
  const p = t.instrument.params;
  const st = useStudio.getState;
  const set = (fn: (p: SynthParams) => SynthParams) => st().live((pr) => ({ ...pr, tracks: pr.tracks.map((x) => (x.id === t.id ? { ...x, instrument: { ...x.instrument, params: fn(x.instrument.params) } } : x)) }));
  const k = (label: string, value: number, min: number, max: number, fn: (v: number) => (p: SynthParams) => SynthParams, o: { log?: boolean; format?: (v: number) => string; def?: number } = {}) => (
    <Knob label={label} value={value} min={min} max={max} log={o.log} def={o.def} format={o.format ?? ((v) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2)))}
      onStart={() => st().beginGesture()} onEnd={() => st().endGesture(`${t.name}: ${label}`)} onChange={(v) => set(fn(v))} />
  );
  const sec = (v: number) => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`);
  const kind = t.instrument.kind;
  const env = (name: 'ampEnv' | 'filterEnv', title: string) => (
    <div className="card col"><div className="section-title" style={{ margin: 0 }}>{title}</div><div className="knob-group">
      {k('Attack', p[name].attack, 0.001, 10, (v) => (q) => ({ ...q, [name]: { ...q[name], attack: v } }), { log: true, format: sec })}
      {k('Decay', p[name].decay, 0.005, 10, (v) => (q) => ({ ...q, [name]: { ...q[name], decay: v } }), { log: true, format: sec })}
      {k('Sustain', p[name].sustain, 0, 1, (v) => (q) => ({ ...q, [name]: { ...q[name], sustain: v } }))}
      {k('Release', p[name].release, 0.005, 15, (v) => (q) => ({ ...q, [name]: { ...q[name], release: v } }), { log: true, format: sec })}
    </div></div>
  );
  return (
    <div className="row wrap" style={{ alignItems: 'flex-start' }}>
      {kind === 'subtractive' && (['osc1', 'osc2'] as const).map((o) => (
        <div key={o} className="card col"><div className="section-title" style={{ margin: 0 }}>{o === 'osc1' ? 'Oscillator 1' : 'Oscillator 2'}</div>
          <div className="row">{WAVES.map((w) => <button key={w} className={`btn sm ${p[o].wave === w ? 'on' : ''}`} onClick={() => { st().beginGesture(); set((q) => ({ ...q, [o]: { ...q[o], wave: w } })); st().endGesture('Waveform'); }}>{w.slice(0, 3)}</button>)}</div>
          <div className="knob-group">
            {k('Level', p[o].level, 0, 1, (v) => (q) => ({ ...q, [o]: { ...q[o], level: v } }))}
            {k('Octave', p[o].octave, -3, 3, (v) => (q) => ({ ...q, [o]: { ...q[o], octave: Math.round(v) } }), { format: (v) => String(Math.round(v)) })}
            {k('Semi', p[o].semi, -24, 24, (v) => (q) => ({ ...q, [o]: { ...q[o], semi: Math.round(v) } }), { format: (v) => String(Math.round(v)) })}
            {k('Detune', p[o].detune, -100, 100, (v) => (q) => ({ ...q, [o]: { ...q[o], detune: v } }), { def: 0, format: (v) => `${v.toFixed(0)}c` })}
          </div>
        </div>
      ))}
      {kind === 'subtractive' && <div className="card col"><div className="section-title" style={{ margin: 0 }}>Voice</div><div className="knob-group">
        {k('Sub', p.subLevel, 0, 1, (v) => (q) => ({ ...q, subLevel: v }))}
        {k('Noise', p.noiseLevel, 0, 1, (v) => (q) => ({ ...q, noiseLevel: v }))}
        {k('Unison', p.unison, 1, 7, (v) => (q) => ({ ...q, unison: Math.round(v) }), { format: (v) => String(Math.round(v)) })}
        {k('Spread', p.unisonSpread, 0, 100, (v) => (q) => ({ ...q, unisonSpread: v }), { format: (v) => `${v.toFixed(0)}c` })}
        {k('Glide', p.glide, 0, 1, (v) => (q) => ({ ...q, glide: v }), { format: sec })}
      </div></div>}
      {kind === 'fm' && <div className="card col"><div className="section-title" style={{ margin: 0 }}>FM</div><div className="knob-group">
        {k('Ratio', p.fm.ratio, 0.25, 16, (v) => (q) => ({ ...q, fm: { ...q.fm, ratio: Math.round(v * 4) / 4 } }))}
        {k('Index', p.fm.index, 0, 20, (v) => (q) => ({ ...q, fm: { ...q.fm, index: v } }))}
        {k('Idx Decay', p.fm.indexDecay, 0.01, 10, (v) => (q) => ({ ...q, fm: { ...q.fm, indexDecay: v } }), { log: true, format: sec })}
        {k('Hammer', p.noiseLevel, 0, 1, (v) => (q) => ({ ...q, noiseLevel: v }))}
      </div></div>}
      {kind === 'organ' && <div className="card col"><div className="section-title" style={{ margin: 0 }}>Drawbars</div><div className="row">
        {p.drawbars.map((d, i) => <label key={i} className="col small" style={{ alignItems: 'center', gap: 2 }}>
          <input type="range" className="vfader" style={{ height: 80 }} min={0} max={8} step={1} value={d} onPointerDown={() => st().beginGesture()} onPointerUp={() => st().endGesture('Drawbar')}
            onChange={(e) => set((q) => ({ ...q, drawbars: q.drawbars.map((x, j) => (j === i ? Number(e.target.value) : x)) }))} />
          <span className="dim">{["16'", "5⅓'", "8'", "4'", "2⅔'", "2'", "1⅗'", "1⅓'", "1'"][i]}</span></label>)}
      </div></div>}
      {kind === 'pluck' && <div className="card col"><div className="section-title" style={{ margin: 0 }}>String model</div><div className="knob-group">
        {k('Damping', p.pluck.damping, 0, 1, (v) => (q) => ({ ...q, pluck: { ...q.pluck, damping: v } }))}
        {k('Bright', p.pluck.brightness, 0, 1, (v) => (q) => ({ ...q, pluck: { ...q.pluck, brightness: v } }))}
        {k('Body', p.pluck.body, 0, 1, (v) => (q) => ({ ...q, pluck: { ...q.pluck, body: v } }))}
      </div></div>}
      {kind !== 'organ' && kind !== 'drumkit' && <div className="card col"><div className="section-title" style={{ margin: 0 }}>Filter</div>
        <div className="row">{(['lowpass', 'highpass', 'bandpass'] as const).map((f) => <button key={f} className={`btn sm ${p.filter.type === f ? 'on' : ''}`} onClick={() => { st().beginGesture(); set((q) => ({ ...q, filter: { ...q.filter, type: f } })); st().endGesture('Filter type'); }}>{f.slice(0, 4)}</button>)}</div>
        <div className="knob-group">
          {k('Cutoff', p.filter.cutoff, 20, 20000, (v) => (q) => ({ ...q, filter: { ...q.filter, cutoff: v } }), { log: true, format: fmtHz })}
          {k('Reso', p.filter.resonance, 0.1, 30, (v) => (q) => ({ ...q, filter: { ...q.filter, resonance: v } }), { log: true })}
          {k('Env Amt', p.filter.envAmount, -6, 8, (v) => (q) => ({ ...q, filter: { ...q.filter, envAmount: v } }), { def: 0, format: (v) => `${v.toFixed(1)}oct` })}
          {k('Key Trk', p.filter.keyTrack, 0, 1, (v) => (q) => ({ ...q, filter: { ...q.filter, keyTrack: v } }))}
        </div></div>}
      {kind !== 'drumkit' && env('ampEnv', 'Amp envelope')}
      {(kind === 'subtractive' || kind === 'fm' || kind === 'sampler') && env('filterEnv', 'Filter envelope')}
      {kind !== 'drumkit' && <div className="card col"><div className="section-title" style={{ margin: 0 }}>Modulation</div><div className="knob-group">
        {k('Vib Rate', p.vibrato.rate, 0, 12, (v) => (q) => ({ ...q, vibrato: { ...q.vibrato, rate: v } }), { format: (v) => `${v.toFixed(1)}Hz` })}
        {k('Vib Depth', p.vibrato.depth, 0, 100, (v) => (q) => ({ ...q, vibrato: { ...q.vibrato, depth: v } }), { format: (v) => `${v.toFixed(0)}c` })}
        {k('Vib Delay', p.vibrato.delay, 0, 3, (v) => (q) => ({ ...q, vibrato: { ...q.vibrato, delay: v } }), { format: sec })}
        {k('LFO Rate', p.lfo.rate, 0.01, 20, (v) => (q) => ({ ...q, lfo: { ...q.lfo, rate: v } }), { log: true, format: (v) => `${v.toFixed(2)}Hz` })}
        {k('LFO→Cut', p.lfo.toCutoff, 0, 4, (v) => (q) => ({ ...q, lfo: { ...q.lfo, toCutoff: v } }))}
        {k('LFO→Amp', p.lfo.toAmp, 0, 1, (v) => (q) => ({ ...q, lfo: { ...q.lfo, toAmp: v } }))}
      </div></div>}
      <div className="card col"><div className="section-title" style={{ margin: 0 }}>Output</div><div className="knob-group">
        {k('Gain', p.gain, -48, 12, (v) => (q) => ({ ...q, gain: v }), { format: fmtDb })}
        {k('Pitch', p.transpose, -24, 24, (v) => (q) => ({ ...q, transpose: Math.round(v) }), { def: 0, format: (v) => `${Math.round(v)}st` })}
        {k('Fine', p.fine, -100, 100, (v) => (q) => ({ ...q, fine: v }), { def: 0, format: (v) => `${v.toFixed(0)}c` })}
        {k('Vel Sens', p.velocitySens, 0, 1, (v) => (q) => ({ ...q, velocitySens: v }))}
        {k('Express', p.expression, 0, 1, (v) => (q) => ({ ...q, expression: v }))}
        {k('Pan', p.pan, -1, 1, (v) => (q) => ({ ...q, pan: v }), { def: 0 })}
        {k('Voices', p.maxVoices, 1, 64, (v) => (q) => ({ ...q, maxVoices: Math.round(v) }), { format: (v) => String(Math.round(v)) })}
      </div></div>
    </div>
  );
}

function DrumPieces({ t }: { t: Track }) {
  const st = useStudio.getState;
  const fileRef = useRef<HTMLInputElement>(null);
  const [pitch, setPitch] = useState(36);
  const setPiece = (pp: number, patch: Record<string, number | null>) => st().live((p) => ({ ...p, tracks: p.tracks.map((x) => (x.id === t.id ? { ...x, instrument: { ...x.instrument, pieces: { ...x.instrument.pieces, [pp]: { ...(x.instrument.pieces[String(pp)] ?? { tune: 0, decay: 1, level: 1, pan: 0, sampleAssetId: null }), ...patch } } } } : x)) }));
  return (
    <div className="col">
      <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void replaceDrumSample(t.id, pitch, f); e.target.value = ''; }} />
      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        {DRUM_PIECES.map((d) => {
          const pc = t.instrument.pieces[String(d.pitch)] ?? { tune: 0, decay: 1, level: 1, pan: 0, sampleAssetId: null };
          return (
            <div key={d.pitch} className="card col" style={{ width: 200, gap: 4 }}>
              <div className="row"><button className="btn sm grow" onClick={() => engine.previewNote(t.id, d.pitch, 0.85)}>▶ {d.name}</button>
                <button className={`btn sm ${pc.sampleAssetId ? 'on' : ''}`} title="Load your own sample for this piece" onClick={() => { setPitch(d.pitch); fileRef.current?.click(); }}>Sample</button>
                {pc.sampleAssetId && <button className="btn sm" title="Back to synthesized" onClick={() => { st().beginGesture(); setPiece(d.pitch, { sampleAssetId: null }); st().endGesture('Clear sample'); }}>✕</button>}
              </div>
              {pc.sampleAssetId && <span className="badge sampled">{engine.assets.names.get(pc.sampleAssetId) ?? 'sample'}</span>}
              <div className="knob-group">
                {(['tune', 'decay', 'level', 'pan'] as const).map((key) => (
                  <Knob key={key} size={28} label={key} value={pc[key]} min={key === 'tune' ? -24 : key === 'decay' ? 0.1 : key === 'level' ? 0 : -1} max={key === 'tune' ? 24 : key === 'decay' ? 4 : key === 'level' ? 2 : 1}
                    def={key === 'tune' || key === 'pan' ? 0 : 1} onStart={() => st().beginGesture()} onEnd={() => st().endGesture(`${d.name} ${key}`)} onChange={(v) => setPiece(d.pitch, { [key]: key === 'tune' ? Math.round(v) : v })} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SamplerZones({ t }: { t: Track }) {
  const st = useStudio.getState;
  const fileRef = useRef<HTMLInputElement>(null);
  const zones = t.instrument.zones;
  const setZone = (i: number, patch: Partial<(typeof zones)[number]>) => st().commit('Edit zone', (p) => ({ ...p, tracks: p.tracks.map((x) => (x.id === t.id ? { ...x, instrument: { ...x.instrument, zones: x.instrument.zones.map((z, j) => (j === i ? { ...z, ...patch } : z)) } } : x)) }));
  return (
    <div className="col">
      <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={(e) => { if (e.target.files) void importInstrumentSamples(e.target.files, t.id); e.target.value = ''; }} />
      <div className="row"><button className="btn" onClick={() => fileRef.current?.click()}>Import samples…</button><span className="dim small">Tip: name files with notes (e.g. "Cello_C3.wav", "Cello_G3.wav") to auto-map key zones.</span></div>
      {!zones.length && <div className="notice warn">This sampler has no samples yet. It stays silent until you import audio. No sample libraries are bundled with AIMS — use samples you own or that are properly licensed.</div>}
      {zones.map((z, i) => (
        <div key={i} className="row small card">
          <b className="grow">{z.name}</b>
          <label className="row">Root<input className="input num" defaultValue={noteName(z.rootPitch)} onBlur={(e) => { const n = parseNoteName(e.target.value); if (n !== null) setZone(i, { rootPitch: n }); }} /></label>
          <label className="row">Keys<input className="input num" defaultValue={noteName(z.loPitch)} onBlur={(e) => { const n = parseNoteName(e.target.value); if (n !== null) setZone(i, { loPitch: n }); }} />–<input className="input num" defaultValue={noteName(z.hiPitch)} onBlur={(e) => { const n = parseNoteName(e.target.value); if (n !== null) setZone(i, { hiPitch: n }); }} /></label>
          <label className="row"><input type="checkbox" checked={z.loop} onChange={(e) => setZone(i, { loop: e.target.checked })} />Loop</label>
          <button className="btn sm" onClick={() => engine.previewNote(t.id, z.rootPitch, 0.8, 0.8)}>▶</button>
          <button className="btn sm" onClick={() => st().commit('Remove zone', (p) => ({ ...p, tracks: p.tracks.map((x) => (x.id === t.id ? { ...x, instrument: { ...x.instrument, zones: x.instrument.zones.filter((_, j) => j !== i) } } : x)) }))}>✕</button>
        </div>
      ))}
    </div>
  );
}

export function InstrumentEditor() {
  const sel = useStudio((s) => s.selectedTrackIds[0]);
  const t = useStudio((s) => s.project.tracks.find((x) => x.id === sel));
  const [tab, setTab] = useState<'sound' | 'fx'>('sound');
  if (!t) return <div className="empty-state">Select a track to edit its instrument and effects.</div>;
  const preset = PRESET_MAP[t.instrument.preset];
  return (
    <div className="editor">
      <div className="editor-toolbar">
        <b style={{ color: t.color }}>{t.name}</b>
        {t.type !== 'audio' && (
          <select className="input" value={t.instrument.preset} onChange={(e) => setInstrumentPreset(t.id, e.target.value)} aria-label="Instrument preset">
            {t.instrument.kind === 'sampler' && <option value="sampler">Sampler (your samples)</option>}
            {[...new Set(PRESETS.map((p) => p.category))].map((c) => <optgroup key={c} label={c}>{PRESETS.filter((p) => p.category === c).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
          </select>
        )}
        <span className={`badge ${t.instrument.source === 'sampled' ? 'sampled' : 'synth'}`}>{t.type === 'audio' ? 'audio track' : t.instrument.source === 'sampled' ? 'sampled instrument' : 'synthesized'}</span>
        <span className="dim small grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.type === 'audio' ? 'Plays recorded / imported audio clips.' : preset?.description ?? 'User-sampled instrument.'}</span>
        <button className={`btn sm ${tab === 'sound' ? 'on' : ''}`} onClick={() => setTab('sound')}>Sound</button>
        <button className={`btn sm ${tab === 'fx' ? 'on' : ''}`} onClick={() => setTab('fx')}>Effects ({t.effects.length})</button>
      </div>
      <div className="editor-body scroll" style={{ padding: 10 }}>
        {tab === 'fx' || t.type === 'audio' ? <EffectsRack host={{ kind: 'track', id: t.id }} /> : (
          <div className="col">
            {t.instrument.kind === 'drumkit' ? (
              <>
                <div className="row"><span className="small muted">Kit character:</span>{(['electronic', '808', 'trap', 'acoustic', 'rock', 'lofi', 'orchestral'] as const).map((k) => <button key={k} className={`btn sm ${t.instrument.kit === k ? 'on' : ''}`} onClick={() => useStudio.getState().commit('Kit', (p) => ({ ...p, tracks: p.tracks.map((x) => (x.id === t.id ? { ...x, instrument: { ...x.instrument, kit: k } } : x)) }))}>{k}</button>)}</div>
                <DrumPieces t={t} />
              </>
            ) : (
              <>
                {t.instrument.kind === 'sampler' && <SamplerZones t={t} />}
                <SynthControls t={t} />
              </>
            )}
            <Keyboard trackId={t.id} low={t.instrument.kind === 'drumkit' ? 35 : 48} octaves={t.instrument.kind === 'drumkit' ? 2 : 3} />
          </div>
        )}
      </div>
    </div>
  );
}
