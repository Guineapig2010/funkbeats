import { useEffect, useState } from 'react';
import { engine } from '../../audio/engine';
import { health, type Health } from '../../ai/client';
import { alignVocals } from '../../compose/transform';
import { addTrack, renderVocalWithProvider, toggleRecord, writeLyricsAI } from '../../state/actions';
import { useStudio } from '../../state/store';
import { uid } from '../../util/id';
import { lineSyllables } from '../../compose/lyrics';
import { freqToMidi } from '../../util/math';
import { noteName } from '../../theory/theory';

/** Autocorrelation pitch detection over an audio clip (analysis only). */
function detectPitches(buf: AudioBuffer, from: number, to: number) {
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  const win = 2048, hop = 1024;
  const out: { t: number; midi: number | null }[] = [];
  for (let s = Math.floor(from * sr); s + win < Math.min(d.length, to * sr); s += hop) {
    let rms = 0;
    for (let i = 0; i < win; i++) rms += d[s + i] ** 2;
    if (Math.sqrt(rms / win) < 0.01) { out.push({ t: s / sr, midi: null }); continue; }
    let best = -1, bestLag = 0;
    for (let lag = Math.floor(sr / 1000); lag < Math.floor(sr / 70); lag++) {
      let c = 0;
      for (let i = 0; i < win - lag; i += 2) c += d[s + i] * d[s + i + lag];
      if (c > best) { best = c; bestLag = lag; }
    }
    out.push({ t: s / sr, midi: bestLag ? freqToMidi(sr / bestLag) : null });
  }
  return out;
}

export function VocalsPanel() {
  const project = useStudio((s) => s.project);
  const recording = useStudio((s) => s.recording);
  const selClip = useStudio((s) => s.selectedClipIds[0]);
  const [h, setH] = useState<Health | null>(null);
  const [topic, setTopic] = useState('');
  const [monitor, setMonitor] = useState(false);
  const [pitchInfo, setPitchInfo] = useState<string | null>(null);
  useEffect(() => { void health(true).then(setH); }, []);
  const st = useStudio.getState;
  const vocal = project.tracks.find((t) => t.role === 'vocal');
  const audioTracks = project.tracks.filter((t) => t.type === 'audio');
  const armed = project.tracks.find((t) => t.armed);
  const sections = project.sections;
  const lyricFor = (sid: string, name: string) => project.lyrics.sections.find((l) => l.sectionId === sid || l.label === name);
  const setLyric = (sid: string, name: string, text: string) => st().live((p) => {
    const ex = p.lyrics.sections.find((l) => l.sectionId === sid || l.label === name);
    const entry = { id: ex?.id ?? uid('l'), label: name, sectionId: sid, text };
    return { ...p, lyrics: { ...p.lyrics, sections: ex ? p.lyrics.sections.map((l) => (l.id === ex.id ? entry : l)) : [...p.lyrics.sections, entry] } };
  });
  const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === selClip && c.kind === 'audio');

  return (
    <div className="editor-body scroll" style={{ padding: 10 }}>
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 14 }}>
        <div className="col" style={{ flex: '2 1 420px', minWidth: 300 }}>
          <div className="row wrap">
            <b>Lyrics</b>
            <input className="input grow" placeholder="Topic / story for new lyrics (optional)" value={topic} onChange={(e) => setTopic(e.target.value)} />
            <button className="btn accent2" onClick={() => void writeLyricsAI(topic)}>{h?.claude ? '✦ Write with Claude' : 'Write (local templates)'}</button>
            <button className="btn" disabled={!vocal} title="Re-compose the vocal guide melody so each syllable gets a note" onClick={() => st().commit('Align vocals to lyrics', (p) => alignVocals(p, Date.now() % 1e6))}>Align melody to syllables</button>
          </div>
          {!h?.claude && <div className="notice info">Local lyric writing uses simple templates. Configure Claude on the server for real songwriting.</div>}
          <div className="row small"><span className="muted">Vocal direction:</span>
            <select className="input" value={project.lyrics.vocalStyle.voice} onChange={(e) => st().commit('Vocal voice', (p) => ({ ...p, lyrics: { ...p.lyrics, vocalStyle: { ...p.lyrics.vocalStyle, voice: e.target.value as 'any' } } }))}>
              <option value="any">Any voice</option><option value="female">Female</option><option value="male">Male</option><option value="choir">Choir</option>
            </select>
            <select className="input" value={project.lyrics.vocalStyle.delivery} onChange={(e) => st().commit('Vocal delivery', (p) => ({ ...p, lyrics: { ...p.lyrics, vocalStyle: { ...p.lyrics.vocalStyle, delivery: e.target.value } } }))}>
              {['natural', 'soft', 'powerful', 'emotional', 'spoken word', 'whispered', 'belted', 'choir'].map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          {!sections.length && <div className="dim">Generate or create a song first — lyrics are organised by song section.</div>}
          {sections.map((s) => {
            const l = lyricFor(s.id, s.name);
            const syl = (l?.text ?? '').split('\n').filter(Boolean).map((x) => lineSyllables(x).length);
            return (
              <div key={s.id} className="card col" style={{ gap: 4 }}>
                <div className="row small"><b>{s.name}</b><span className="dim">{s.kind}</span><span className="grow" />{syl.length > 0 && <span className="dim">syllables/line: {syl.join(' · ')}</span>}</div>
                <textarea className="input" rows={Math.max(2, (l?.text ?? '').split('\n').length)} placeholder={`Lyrics for ${s.name}…`} value={l?.text ?? ''}
                  onFocus={() => st().beginGesture()} onBlur={() => st().endGesture('Edit lyrics')} onChange={(e) => setLyric(s.id, s.name, e.target.value)} />
              </div>
            );
          })}
        </div>
        <div className="col" style={{ flex: '1 1 300px', minWidth: 280 }}>
          <b>Vocal performance</b>
          <div className="notice warn">
            AIMS does not fake singing. The <i>“Lead Vocal – guide”</i> track is a synthesized guide tone that plays the composed vocal melody with lyric syllables on its notes — it is not a voice.
            Real vocals come from <b>recording</b>, <b>importing</b> a vocal file, or a <b>connected vocal provider</b>.
          </div>
          <div className="card col">
            <div className="row"><b className="grow">Record</b>{recording && <span className="badge bad">● REC</span>}</div>
            <div className="small muted">Arms an audio track, counts in {project.metronome.countInBars} bar(s) with the metronome and records from the cursor. Use headphones to avoid bleed.</div>
            <div className="row wrap">
              <select className="input grow" value={armed?.id ?? ''} onChange={(e) => st().commit('Arm track', (p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, armed: t.id === e.target.value })) }))}>
                <option value="">(new audio track)</option>
                {audioTracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button className="btn" onClick={() => addTrack('audio')}>+ Audio track</button>
            </div>
            <div className="row wrap">
              <label className="row small">Count-in<select className="input" value={project.metronome.countInBars} onChange={(e) => st().commit('Count-in', (p) => ({ ...p, metronome: { ...p.metronome, countInBars: Number(e.target.value) } }))}>{[0, 1, 2, 4].map((n) => <option key={n} value={n}>{n} bar{n === 1 ? '' : 's'}</option>)}</select></label>
              <label className="row small"><input type="checkbox" checked={monitor} onChange={async (e) => {
                setMonitor(e.target.checked);
                try { if (e.target.checked) { await engine.enableInput(); engine.setMonitoring(armed?.id ?? null); } else engine.setMonitoring(null); } catch (err) { st().toast('error', (err as Error).message); setMonitor(false); }
              }} />Input monitoring (through track effects)</label>
            </div>
            <button className={`btn ${recording ? 'rec on' : 'primary'}`} onClick={() => void toggleRecord()}>{recording ? '■ Stop recording' : '● Record'}</button>
          </div>
          <div className="card col">
            <b>Vocal provider</b>
            {h?.vocalProvider ? (
              <>
                <div className="small">Connected: <b>{h.vocalProvider.name}</b> — {h.vocalProvider.singing ? 'singing synthesis' : 'speech only (text-to-speech, not singing)'}.</div>
                <button className="btn accent2" onClick={() => void renderVocalWithProvider()}>{h.vocalProvider.singing ? 'Render AI vocal from melody + lyrics' : 'Render spoken-word section (TTS)'}</button>
              </>
            ) : <div className="small muted">No vocal/audio generation provider is configured. See README → “Vocal providers” to connect one on the server.</div>}
          </div>
          <div className="card col">
            <b>Pitch analysis</b>
            <div className="small muted">Select an audio clip, then analyse. Shows detected notes and tuning deviation. (Automatic pitch correction / time-preserving re-tuning is not implemented; use clip playback rate for whole-clip transposition.)</div>
            <button className="btn" disabled={!clip} onClick={() => {
              const buf = clip?.audio && engine.assets.get(clip.audio.assetId);
              if (!buf || !clip?.audio) return setPitchInfo('Audio not loaded.');
              const res = detectPitches(buf, clip.audio.startSec, clip.audio.startSec + Math.min(30, buf.duration));
              const voiced = res.filter((r) => r.midi !== null) as { t: number; midi: number }[];
              if (!voiced.length) return setPitchInfo('No clear pitch detected.');
              const cents = voiced.map((v) => (v.midi - Math.round(v.midi)) * 100);
              const avg = cents.reduce((a, b) => a + Math.abs(b), 0) / cents.length;
              const notes = [...new Set(voiced.map((v) => noteName(Math.round(v.midi))))].slice(0, 16);
              setPitchInfo(`${voiced.length} voiced frames · notes: ${notes.join(' ')} · average deviation ${avg.toFixed(0)} cents`);
            }}>Analyse selected clip</button>
            {pitchInfo && <div className="small mono">{pitchInfo}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
