import { useCallback, useEffect, useState } from 'react';
import { engine } from '../../audio/engine';
import { MASTERING_PRESETS, masteringChain } from '../../model/effects';
import { useStudio } from '../../state/store';
import { Meter, Spectrogram, Spectrum } from '../components/widgets';
import { EffectsRack } from './EffectsRack';

function Correlation() {
  const [c, setC] = useState(1);
  const [gr, setGr] = useState(0);
  useEffect(() => { const id = setInterval(() => { setC(engine.correlation()); setGr(engine.limiterReduction()); }, 150); return () => clearInterval(id); }, []);
  return (
    <div className="col small">
      <div className="row">Stereo correlation <span className="mono">{c.toFixed(2)}</span><div className="grow progress" style={{ height: 6 }}><div style={{ width: `${((c + 1) / 2) * 100}%`, background: c < 0 ? 'var(--bad)' : 'var(--good)' }} /></div></div>
      <div className="row">Limiter gain reduction <span className="mono">{gr.toFixed(1)} dB</span><div className="grow progress" style={{ height: 6 }}><div style={{ width: `${Math.min(100, -gr * 8)}%`, background: 'var(--warn)' }} /></div></div>
    </div>
  );
}

export function MasterPanel() {
  const master = useStudio((s) => s.project.master);
  const returns = useStudio((s) => s.project.returns);
  const sr = useStudio((s) => s.project.sampleRate);
  const st = useStudio.getState;
  const read = useCallback(() => engine.readMaster(), []);
  const [host, setHost] = useState<string>('master');
  return (
    <div className="editor-body scroll" style={{ padding: 10 }}>
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 14 }}>
        <div className="col" style={{ flex: '1 1 320px' }}>
          <div className="row"><b className="grow">Output analysis</b><Meter read={read} width={22} height={60} /></div>
          <Spectrum height={110} />
          <Spectrogram height={80} />
          <Correlation />
          <div className="row small">
            Engine sample rate
            <select className="input" value={sr} onChange={async (e) => { const v = Number(e.target.value) as 44100; st().commit('Sample rate', (p) => ({ ...p, sampleRate: v })); try { await engine.setSampleRate(v); } catch (err) { st().toast('error', (err as Error).message); } }}>
              <option value={44100}>44.1 kHz</option><option value={48000}>48 kHz</option>
            </select>
            <span className="dim">(processing is 32-bit float)</span>
          </div>
        </div>
        <div className="col" style={{ flex: '3 1 520px' }}>
          <div className="row wrap">
            <b>Mastering preset</b>
            {MASTERING_PRESETS.map((m) => <button key={m.id} className={`btn sm ${master.preset === m.id ? 'on' : ''}`} title={m.description} onClick={() => st().commit(`Mastering: ${m.name}`, (p) => ({ ...p, master: { ...p.master, effects: masteringChain(m.id), preset: m.id } }))}>{m.name}</button>)}
          </div>
          <div className="notice info small">Presets are adjustable starting points built from real processors (EQ, compression, stereo width, look-ahead limiter). Final quality still depends on the arrangement, sounds and mix.</div>
          <div className="row">
            <span className="small muted">Edit chain:</span>
            <button className={`btn sm ${host === 'master' ? 'on' : ''}`} onClick={() => setHost('master')}>Master</button>
            {returns.map((r) => <button key={r.id} className={`btn sm ${host === r.id ? 'on' : ''}`} onClick={() => setHost(r.id)}>{r.name} return</button>)}
          </div>
          <EffectsRack host={host === 'master' ? { kind: 'master' } : { kind: 'return', id: host }} />
        </div>
      </div>
    </div>
  );
}
