import { useRef, useState } from 'react';
import type { Analysis } from '../../export/analysis';
import * as A from '../../state/actions';
import { useStudio } from '../../state/store';
import { Modal } from '../components/widgets';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useStudio((s) => s.project);
  const selection = useStudio((s) => s.selection);
  const [o, setO] = useState<A.ExportOptions>({ format: 'wav', sampleRate: project.sampleRate, bitDepth: 24, kbps: 256, normalize: false, range: 'song', stems: false, stemsWithMaster: false });
  const [prog, setProg] = useState<A.ExportProgress | null>(null);
  const [result, setResult] = useState<{ files: string[]; analysis: Analysis | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const run = async () => {
    setErr(null); setResult(null);
    ctl.current = new AbortController();
    try {
      setResult(await A.exportAudio(o, setProg, ctl.current.signal));
    } catch (e) {
      setErr((e as Error).message);
    } finally { setProg(null); ctl.current = null; }
  };
  const up = (patch: Partial<A.ExportOptions>) => setO({ ...o, ...patch });
  return (
    <Modal title="Export" onClose={() => { ctl.current?.abort(); onClose(); }}>
      <div className="row wrap">
        <label className="field">Format<select className="input" value={o.format} onChange={(e) => up({ format: e.target.value as 'wav' })}><option value="wav">WAV (lossless)</option><option value="mp3">MP3 (LAME encoder)</option></select></label>
        <label className="field">Sample rate<select className="input" value={o.sampleRate} onChange={(e) => up({ sampleRate: Number(e.target.value) as 44100 })}><option value={44100}>44.1 kHz</option><option value={48000}>48 kHz</option></select></label>
        {o.format === 'wav' ? <label className="field">Bit depth<select className="input" value={o.bitDepth} onChange={(e) => up({ bitDepth: Number(e.target.value) as 24 })}><option value={16}>16-bit (dithered)</option><option value={24}>24-bit</option><option value={32}>32-bit float</option></select></label>
          : <label className="field">Bitrate<select className="input" value={o.kbps} onChange={(e) => up({ kbps: Number(e.target.value) })}>{[128, 192, 256, 320].map((k) => <option key={k} value={k}>{k} kbps</option>)}</select></label>}
        <label className="field">Range<select className="input" value={o.range} onChange={(e) => up({ range: e.target.value as 'song' })}><option value="song">Whole song</option><option value="loop">Loop region</option><option value="selection" disabled={!selection}>Selection</option></select></label>
      </div>
      <label className="row"><input type="checkbox" checked={o.normalize} onChange={(e) => up({ normalize: e.target.checked })} />Normalize peak to −1 dBFS</label>
      <label className="row"><input type="checkbox" checked={o.stems} onChange={(e) => up({ stems: e.target.checked })} />Export individual track stems (one file per track, includes its sends/returns)</label>
      {o.stems && <label className="row" style={{ marginLeft: 22 }}><input type="checkbox" checked={o.stemsWithMaster} onChange={(e) => up({ stemsWithMaster: e.target.checked })} />Apply master chain to stems</label>}
      <div className="dim small">Rendering is offline (faster than real time where possible) and uses exactly the same instruments, effects, automation and mixer settings as playback.</div>
      {prog && <div className="col"><div className="progress"><div style={{ width: `${Math.round(prog.fraction * 100)}%` }} /></div><div className="row small"><span className="grow">{prog.label}</span><button className="btn sm" onClick={() => ctl.current?.abort()}>Cancel</button></div></div>}
      {err && <div className="notice bad">{err}</div>}
      {result && (
        <div className="notice info">
          Downloaded: {result.files.join(', ')}
          {result.analysis && <div className="mono small">Peak {result.analysis.peakDb.toFixed(1)} dBFS · Integrated loudness {Number.isFinite(result.analysis.lufs) ? result.analysis.lufs.toFixed(1) : '—'} LUFS (est.) · {result.analysis.durationSec.toFixed(1)} s{result.analysis.clippedSamples ? ` · ${result.analysis.clippedSamples} clipped samples` : ''}</div>}
        </div>
      )}
      <div className="row wrap">
        <button className="btn primary" disabled={!!prog || !project.tracks.length} onClick={() => void run()}>Render & download</button>
        <div className="grow" />
        <button className="btn" onClick={() => A.exportMidi()}>MIDI (.mid)</button>
        <button className="btn" onClick={() => A.exportProjectFile()}>Project file (.aims.json)</button>
      </div>
    </Modal>
  );
}
