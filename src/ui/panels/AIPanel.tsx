import { useEffect, useRef, useState } from 'react';
import { health, type Health } from '../../ai/client';
import { GENRE_LIST, GENRES, MOOD_LIST } from '../../compose/styles';
import type { GenerationSettings } from '../../model/schema';
import { MeterMap } from '../../model/tempo';
import * as A from '../../state/actions';
import { useStudio } from '../../state/store';

export const EXAMPLES = [
  'Create a two-minute heroic orchestral soundtrack with emotional strings, bold brass, cinematic percussion, and a massive final climax.',
  'Create an energetic electronic dance track with powerful bass, detailed percussion, and a catchy melody.',
  'Create an intense rock anthem with electric guitars, emotional male vocals, and an explosive chorus.',
  'Create peaceful piano music with rain ambience and soft strings.',
  'Dark trap beat at 140 bpm with 808s, bell melody and haunting choir.',
  'Laid-back lo-fi hip hop for studying, warm keys, dusty drums, 90 seconds.',
  'Smooth late-night jazz with saxophone and walking bass.',
  'Nostalgic 80s synthwave night drive with arpeggios and a soaring lead.',
];

export function GeneratorControls({ compact = false }: { compact?: boolean }) {
  const s = useStudio((st) => st.genSettings);
  const busy = useStudio((st) => st.busy);
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => { void health().then(setH); }, []);
  const set = (patch: Partial<GenerationSettings>) => useStudio.getState().set({ genSettings: { ...useStudio.getState().genSettings, ...patch } });
  const slider = (label: string, key: 'complexity' | 'energy' | 'creativity', lo: string, hi: string) => (
    <label className="field">{label}<div className="row"><span className="dim small">{lo}</span><input className="grow" type="range" min={0} max={1} step={0.05} value={s[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} /><span className="dim small">{hi}</span></div></label>
  );
  return (
    <div className="col">
      <textarea className="input prompt-box" placeholder="Describe your song… e.g. “An uplifting cinematic piece with soaring strings and a big drum finale”" value={s.prompt} onChange={(e) => set({ prompt: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void A.generate({ ...s, seed: Math.floor(Math.random() * 1e9) }); }} />
      <div className="ai-grid">
        <label className="field">Genre<select className="input" value={s.genre} onChange={(e) => set({ genre: e.target.value })}><option value="auto">Auto (from prompt)</option>{GENRE_LIST.map((g) => <option key={g} value={g}>{GENRES[g].label}</option>)}</select></label>
        <label className="field">Mood<select className="input" value={s.mood} onChange={(e) => set({ mood: e.target.value })}><option value="auto">Auto (from prompt)</option>{MOOD_LIST.map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}</select></label>
        <label className="field">Duration<div className="row"><input className="grow" type="range" min={15} max={420} step={5} value={s.durationSec} onChange={(e) => set({ durationSec: Number(e.target.value) })} /><span className="mono small">{Math.floor(s.durationSec / 60)}:{String(s.durationSec % 60).padStart(2, '0')}</span></div></label>
        <label className="field">Tempo (BPM)<div className="row"><input className="input num" style={{ width: '100%' }} placeholder="auto" value={s.bpm || ''} onChange={(e) => set({ bpm: Math.max(0, Math.min(220, Number(e.target.value) || 0)) })} /></div></label>
        {!compact && <label className="field">Key<input className="input" placeholder="auto, e.g. D minor" value={s.key === 'auto' ? '' : s.key} onChange={(e) => set({ key: e.target.value.trim() || 'auto' })} /></label>}
        <label className="field">Vocals<select className="input" value={s.vocals} onChange={(e) => set({ vocals: e.target.value as GenerationSettings['vocals'] })}>
          <option value="none">None (instrumental)</option><option value="recorded">Guide melody + lyrics (for recording)</option><option value="ai" disabled={!h?.vocalProvider?.singing}>AI-generated singing{h?.vocalProvider?.singing ? '' : ' (no provider)'}</option>
        </select></label>
        {!compact && <label className="field">Instruments<input className="input" placeholder="auto, e.g. piano, cello, choir" value={s.instrumentation === 'auto' ? '' : s.instrumentation} onChange={(e) => set({ instrumentation: e.target.value.trim() || 'auto' })} /></label>}
        {!compact && <label className="field">Structure<input className="input" placeholder="auto, e.g. intro, verse, chorus, outro" value={s.structure === 'auto' ? '' : s.structure} onChange={(e) => set({ structure: e.target.value.trim() || 'auto' })} /></label>}
      </div>
      {slider('Complexity', 'complexity', 'simple', 'complex')}
      {slider('Energy', 'energy', 'gentle', 'powerful')}
      {slider('Creativity', 'creativity', 'conservative', 'experimental')}
      <div className="row wrap">
        <span className="small muted">Composer</span>
        <button className={`chip ${s.engine === 'local' ? 'on' : ''}`} onClick={() => set({ engine: 'local' })} title="Algorithmic composer in your browser — works offline">Local engine</button>
        <button className={`chip ${s.engine === 'claude' ? 'on' : ''}`} onClick={() => set({ engine: 'claude' })} disabled={!h?.claude} title={h?.claude ? `Claude (${h.model}) plans the song and writes melodies` : 'Claude not configured on the server'}>Claude {h?.claude ? '' : '(not configured)'}</button>
        <span className="grow" />
        <label className="row small dim" title="Same seed + settings = same song">Seed<input className="input num" value={s.seed} onChange={(e) => set({ seed: Number(e.target.value) || 0 })} /></label>
      </div>
      <button className="btn primary big" disabled={!!busy} onClick={() => void A.generate({ ...s, seed: s.seed })}>{busy ? busy : '♪ Generate Music'}</button>
      {busy && <div className="row"><div className="busy-bar grow" /><button className="btn sm" onClick={A.cancelBusy}>Cancel</button></div>}
    </div>
  );
}

export function AIPanel() {
  const hasTracks = useStudio((s) => s.project.tracks.length > 0);
  const selection = useStudio((s) => s.selection);
  const project = useStudio((s) => s.project);
  const busy = useStudio((s) => s.busy);
  const [instr, setInstr] = useState('');
  const [inst, setInst] = useState('');
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const meter = MeterMap.fromProject(project);
  const scope = selection ? `bars ${meter.beatToBar(selection.from).bar + 1}–${meter.beatToBar(selection.to - 1e-6).bar + 1}` : 'whole song';
  const act = (a: A.AiAction, label: string, title: string) => <button className="btn" disabled={!hasTracks || !!busy} title={title} onClick={() => A.aiAction(a)}>{label}</button>;
  return (
    <div className="scroll" style={{ flex: 1 }}>
      <div className="ai-hero">
        <GeneratorControls />
        <div className="section-title">AI music actions <span className="badge">{scope}</span></div>
        <div className="dim small">Select a range on the timeline (drag in empty space or click a section name) to limit actions to it. Every action is undoable.</div>
        <div className="ai-actions">
          <button className="btn" disabled={!!busy} title="Recompose everything (new seed) — or only the selection" onClick={() => A.aiAction('regenerate')}>↻ Regenerate{selection ? ' selection' : ' song'}</button>
          {act('extend', '⇥ Extend song', 'Add another chorus/climax before the ending')}
          {act('remix', '⚡ Remix', 'Re-arrange in a contrasting genre, keeping melody and harmony')}
          {act('variation', '≈ Create variation', 'Fresh take on the parts with more creative choices')}
          {act('improve-melody', '♪ Improve melody', 'New melody (and the parts that follow it)')}
          {act('improve-chords', '♯ Improve chords', 'New progression; melody is re-fitted to it')}
          {act('improve-rhythm', '🥁 Improve rhythm', 'New drum and bass grooves')}
          {act('cinematic', '🎬 More cinematic', 'Add strings, ostinato, horns, taiko, choir, timpani and hall reverb')}
          {act('energy-up', '▲ Increase energy', 'More parts, denser rhythms, louder drums/bass')}
          {act('soften', '▼ Soften arrangement', 'Fewer parts, gentler dynamics')}
          {act('new-intro', '⇤ New introduction', 'Compose a new intro')}
          {act('new-ending', '⇥ New ending', 'Compose a new ending with a proper cadence')}
          {act('harmonies', '♫ Generate harmonies', 'Harmony line a third from the lead')}
          {act('humanize', '∿ Humanize', 'Natural timing and velocity variation')}
        </div>
        <div className="row">
          <select className="input grow" value="" disabled={!hasTracks} onChange={(e) => { if (e.target.value) A.changeGenre(e.target.value); }} aria-label="Change genre">
            <option value="">Change genre…</option>{GENRE_LIST.map((g) => <option key={g} value={g}>{GENRES[g].label}</option>)}
          </select>
        </div>
        <div className="row">
          <input className="input grow" placeholder="Instrument, e.g. choir, flute, 808" value={inst} onChange={(e) => setInst(e.target.value)} />
          <button className="btn" disabled={!inst.trim() || !hasTracks} onClick={() => { A.addInstrumentAI(inst.trim()); setInst(''); }}>Add</button>
          <button className="btn" disabled={!inst.trim() || !hasTracks} onClick={() => { A.removeInstrumentsAI(inst.trim()); setInst(''); }}>Remove</button>
        </div>
        <div className="section-title">Instruction for {scope}</div>
        <textarea ref={promptRef} className="input" rows={3} placeholder="e.g. Make these eight bars much more dramatic, add a rising string section, and give the drums a more powerful rhythm." value={instr} onChange={(e) => setInstr(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && instr.trim()) { void A.runInstruction(instr.trim()); setInstr(''); } }} />
        <button className="btn accent2" disabled={!instr.trim() || !!busy || !hasTracks} onClick={() => { void A.runInstruction(instr.trim()); setInstr(''); useStudio.getState().set({ rightTab: 'chat' }); }}>Apply instruction</button>
      </div>
    </div>
  );
}

export function ChatPanel() {
  const chat = useStudio((s) => s.chat);
  const busy = useStudio((s) => s.busy);
  const [text, setText] = useState('');
  const [h, setH] = useState<Health | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { void health().then(setH); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat.length]);
  const send = () => { if (!text.trim()) return; void A.runInstruction(text.trim()); setText(''); };
  return (
    <div className="col" style={{ flex: 1, minHeight: 0, gap: 0 }}>
      <div className="notice small" style={{ margin: 8 }}>
        {h?.claude ? <>Assistant: <b>Claude ({h.model})</b>. It sees a structured summary of your project and returns validated edit commands — never code.</>
          : <><b>Local assistant (offline).</b> Understands common requests (“bass too weak”, “new chorus melody”, “add a choir”, “more energy here”, “make it jazz”). Set ANTHROPIC_API_KEY on the server for free-form conversation with Claude.</>}
      </div>
      <div className="chat">
        {!chat.length && <div className="dim small">Try: “Make this sound more like a movie soundtrack”, “The bass sounds too weak”, “Give the chorus a completely different melody”.</div>}
        {chat.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.text}
            {!!m.applied?.length && <ul className="small">{m.applied.map((a, j) => <li key={j} style={{ color: 'var(--good)' }}>{a}</li>)}</ul>}
            {!!m.errors?.length && <ul className="small">{m.errors.map((a, j) => <li key={j} style={{ color: 'var(--bad)' }}>{a}</li>)}</ul>}
          </div>
        ))}
        {busy && <div className="msg assistant dim">{busy}</div>}
        <div ref={endRef} />
      </div>
      <div className="row" style={{ padding: 8, borderTop: '1px solid var(--line)' }}>
        <textarea className="input grow" rows={2} value={text} placeholder="Ask for a change… (Enter to send)" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn primary" disabled={!!busy} onClick={send}>Send</button>
      </div>
    </div>
  );
}
