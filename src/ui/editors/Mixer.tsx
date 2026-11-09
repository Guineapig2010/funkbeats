import { useCallback } from 'react';
import { engine } from '../../audio/engine';
import { EFFECT_DEFS } from '../../model/effects';
import type { Project, ReturnBus, Track } from '../../model/schema';
import { useStudio } from '../../state/store';
import { Knob, Meter, fmtDb } from '../components/widgets';

function Fader({ value, onChange, onStart, onEnd }: { value: number; onChange: (v: number) => void; onStart: () => void; onEnd: () => void }) {
  return <input className="vfader" type="range" min={-60} max={6} step={0.1} value={value} onPointerDown={onStart} onPointerUp={onEnd} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => { onStart(); onChange(0); onEnd(); }} title={`${value.toFixed(1)} dB (double-click: 0 dB)`} />;
}

function TrackStrip({ t, selected }: { t: Track; selected: boolean }) {
  const st = useStudio.getState;
  const returns = useStudio((s) => s.project.returns);
  const live = (patch: Partial<Track>) => st().live((p) => ({ ...p, tracks: p.tracks.map((x) => (x.id === t.id ? { ...x, ...patch } : x)) }));
  const commitPatch = (patch: Partial<Track>, label: string) => st().commit(label, (p) => ({ ...p, tracks: p.tracks.map((x) => (x.id === t.id ? { ...x, ...patch } : x)) }));
  const read = useCallback(() => engine.readTrack(t.id), [t.id]);
  return (
    <div className={`strip ${selected ? 'sel' : ''}`} onPointerDown={() => st().set({ selectedTrackIds: [t.id] })}>
      <div className="sname" style={{ color: t.color }} title={t.name}>{t.name}</div>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2, minHeight: 40 }}>
        {t.effects.slice(0, 4).map((e) => <div key={e.id} className={`fxslot ${e.enabled ? '' : 'off'}`} title={EFFECT_DEFS[e.type].name} onClick={() => st().set({ bottomTab: 'instrument', selectedTrackIds: [t.id] })}>{EFFECT_DEFS[e.type].name}</div>)}
        {t.effects.length > 4 && <div className="dim small">+{t.effects.length - 4} more</div>}
        {!t.effects.length && <div className="fxslot dim" onClick={() => st().set({ bottomTab: 'instrument', selectedTrackIds: [t.id] })}>+ insert fx</div>}
      </div>
      <div className="row" style={{ gap: 2 }}>
        {returns.map((r) => {
          const lvl = t.sends.find((s) => s.returnId === r.id)?.level ?? 0;
          return <Knob key={r.id} size={26} label={r.name.slice(0, 4)} value={lvl} min={0} max={1} def={0} format={(v) => `${Math.round(v * 100)}`}
            onStart={() => st().beginGesture()} onEnd={() => st().endGesture(`${r.name} send`)}
            onChange={(v) => live({ sends: t.sends.some((s) => s.returnId === r.id) ? t.sends.map((s) => (s.returnId === r.id ? { ...s, level: v } : s)) : [...t.sends, { returnId: r.id, level: v }] })} />;
        })}
      </div>
      <Knob size={30} label="Pan" value={t.pan} min={-1} max={1} def={0} format={(v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)}
        onStart={() => st().beginGesture()} onEnd={() => st().endGesture('Pan')} onChange={(v) => live({ pan: Math.abs(v) < 0.02 ? 0 : v })} />
      <div className="fader-wrap">
        <Fader value={t.volume} onStart={() => st().beginGesture()} onEnd={() => st().endGesture('Volume')} onChange={(v) => live({ volume: v })} />
        <Meter read={read} width={12} height={130} />
      </div>
      <span className="mono small">{fmtDb(t.volume)} dB</span>
      <div className="row" style={{ gap: 3 }}>
        <button className={`ms m ${t.mute ? 'on' : ''}`} onClick={() => commitPatch({ mute: !t.mute }, 'Mute')}>M</button>
        <button className={`ms s ${t.solo ? 'on' : ''}`} onClick={() => commitPatch({ solo: !t.solo }, 'Solo')}>S</button>
      </div>
      <select className="input" style={{ height: 20, fontSize: 10, width: '100%', padding: '0 2px' }} value={t.output} title="Output routing" onChange={(e) => commitPatch({ output: e.target.value }, 'Output routing')}>
        <option value="master">→ Master</option>
        {returns.map((r) => <option key={r.id} value={r.id}>→ {r.name} bus</option>)}
      </select>
    </div>
  );
}

function ReturnStrip({ r }: { r: ReturnBus }) {
  const st = useStudio.getState;
  const read = useCallback(() => engine.readReturn(r.id), [r.id]);
  const live = (patch: Partial<ReturnBus>) => st().live((p: Project) => ({ ...p, returns: p.returns.map((x) => (x.id === r.id ? { ...x, ...patch } : x)) }));
  return (
    <div className="strip" style={{ background: '#161b22' }}>
      <div className="sname" style={{ color: r.color }}>{r.name} (return)</div>
      {r.effects.map((e) => <div key={e.id} className="fxslot" onClick={() => st().set({ bottomTab: 'master' })}>{EFFECT_DEFS[e.type].name}</div>)}
      <div className="fader-wrap">
        <Fader value={r.volume} onStart={() => st().beginGesture()} onEnd={() => st().endGesture('Return volume')} onChange={(v) => live({ volume: v })} />
        <Meter read={read} width={12} height={130} />
      </div>
      <span className="mono small">{fmtDb(r.volume)} dB</span>
      <button className={`ms m ${r.mute ? 'on' : ''}`} onClick={() => st().commit('Mute return', (p) => ({ ...p, returns: p.returns.map((x) => (x.id === r.id ? { ...x, mute: !x.mute } : x)) }))}>M</button>
    </div>
  );
}

export function Mixer() {
  const tracks = useStudio((s) => s.project.tracks);
  const returns = useStudio((s) => s.project.returns);
  const master = useStudio((s) => s.project.master);
  const sel = useStudio((s) => s.selectedTrackIds);
  const st = useStudio.getState;
  const readMaster = useCallback(() => engine.readMaster(), []);
  return (
    <div className="mixer">
      {tracks.map((t) => <TrackStrip key={t.id} t={t} selected={sel.includes(t.id)} />)}
      {!tracks.length && <div className="empty-state" style={{ width: 300 }}>No tracks yet.</div>}
      <div className="sep" />
      {returns.map((r) => <ReturnStrip key={r.id} r={r} />)}
      <div className="strip master">
        <div className="sname">MASTER</div>
        {master.effects.map((e) => <div key={e.id} className={`fxslot ${e.enabled ? '' : 'off'}`} onClick={() => st().set({ bottomTab: 'master' })}>{EFFECT_DEFS[e.type].name}</div>)}
        <div className="fader-wrap">
          <Fader value={master.volume} onStart={() => st().beginGesture()} onEnd={() => st().endGesture('Master volume')} onChange={(v) => st().live((p) => ({ ...p, master: { ...p.master, volume: v } }))} />
          <Meter read={readMaster} width={18} height={130} />
        </div>
        <span className="mono small">{fmtDb(master.volume)} dB</span>
      </div>
    </div>
  );
}
