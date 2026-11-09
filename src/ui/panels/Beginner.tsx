import { useEffect, useState } from 'react';
import { health, type Health } from '../../ai/client';
import * as A from '../../state/actions';
import { useStudio } from '../../state/store';
import { EXAMPLES, GeneratorControls } from './AIPanel';

export function Beginner() {
  const set = useStudio((s) => s.set);
  const hasTracks = useStudio((s) => s.project.tracks.length > 0);
  const playing = useStudio((s) => s.playing);
  const name = useStudio((s) => s.project.name);
  const chat = useStudio((s) => s.chat);
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => { void health().then(setH); }, []);
  const last = [...chat].reverse().find((m) => m.role === 'assistant');
  return (
    <div className="beginner">
      <div className="beginner-inner">
        <div className="row"><div className="brand-logo">AI</div><b>AIMS — AI Music Studio</b><span className="grow" /><button className="btn" onClick={() => set({ mode: 'studio' })}>Open full studio →</button></div>
        <h1>Describe a song. Hear it in seconds.</h1>
        <p className="lead">AIMS composes an original arrangement — melody, harmony, bass, drums and more — and plays it with its built-in synthesizers. Then you can edit every note in the studio and export WAV, MP3, stems or MIDI.</p>
        <div className="row wrap small">
          <span className="badge good">Local composer ready (no account needed)</span>
          <span className={`badge ${h?.claude ? 'good' : ''}`}>{h?.claude ? `Claude connected (${h.model})` : 'Claude not configured — optional'}</span>
          <span className={`badge ${h?.vocalProvider ? 'good' : 'warn'}`}>{h?.vocalProvider ? `Vocals: ${h.vocalProvider.name}` : 'AI singing: needs a vocal provider'}</span>
        </div>
        <div className="card"><GeneratorControls compact /></div>
        <div className="section-title">Need ideas? Click one</div>
        <div className="examples">{EXAMPLES.map((e) => <button key={e} className="example" onClick={() => set({ genSettings: { ...useStudio.getState().genSettings, prompt: e } })}>{e}</button>)}</div>
        {hasTracks && (
          <div className="card col">
            <div className="row"><b className="grow">“{name}”</b>
              <button className="btn primary big" onClick={() => void A.togglePlay()}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
              <button className="btn big" onClick={() => A.stop(true)}>■</button>
            </div>
            {last && <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{last.text}</div>}
            <div className="row wrap">
              <button className="btn" onClick={() => A.aiAction('regenerate')}>↻ Try another version</button>
              <button className="btn" onClick={() => A.aiAction('energy-up')}>▲ More energy</button>
              <button className="btn" onClick={() => A.aiAction('cinematic')}>🎬 More cinematic</button>
              <button className="btn" onClick={() => A.aiAction('improve-melody')}>♪ New melody</button>
              <button className="btn" onClick={() => set({ mode: 'studio' })}>✎ Edit in studio</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
