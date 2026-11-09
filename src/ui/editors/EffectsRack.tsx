import { EFFECT_DEFS, EFFECT_PRESETS, makeEffect } from '../../model/effects';
import type { Effect, EffectType, Project } from '../../model/schema';
import { useStudio } from '../../state/store';
import { Knob, fmtHz } from '../components/widgets';

export type FxHost = { kind: 'track'; id: string } | { kind: 'return'; id: string } | { kind: 'master' };

const NONE: Effect[] = [];
export function getEffects(p: Project, h: FxHost): Effect[] {
  if (h.kind === 'master') return p.master.effects;
  if (h.kind === 'return') return p.returns.find((r) => r.id === h.id)?.effects ?? NONE;
  return p.tracks.find((t) => t.id === h.id)?.effects ?? NONE;
}
export function setEffects(p: Project, h: FxHost, fx: Effect[]): Project {
  if (h.kind === 'master') return { ...p, master: { ...p.master, effects: fx } };
  if (h.kind === 'return') return { ...p, returns: p.returns.map((r) => (r.id === h.id ? { ...r, effects: fx } : r)) };
  return { ...p, tracks: p.tracks.map((t) => (t.id === h.id ? { ...t, effects: fx } : t)) };
}

function fmt(v: number, unit?: string) {
  if (unit === 'Hz') return fmtHz(v);
  if (unit === 's') return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
  if (unit === 'dB' || unit === 'dBFS') return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  if (unit === 'beats') return `${v}b`;
  return Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2);
}

export function EffectCard({ fx, host, index, count }: { fx: Effect; host: FxHost; index: number; count: number }) {
  const st = useStudio.getState;
  const tracks = useStudio((s) => s.project.tracks);
  const def = EFFECT_DEFS[fx.type];
  const edit = (fn: (e: Effect) => Effect, label?: string) => {
    const apply = (p: Project) => setEffects(p, host, getEffects(p, host).map((e) => (e.id === fx.id ? fn(e) : e)));
    if (label) st().commit(label, apply); else st().live(apply);
  };
  const move = (d: number) => st().commit('Reorder effects', (p) => {
    const list = [...getEffects(p, host)];
    const i = list.findIndex((e) => e.id === fx.id);
    const j = i + d;
    if (j < 0 || j >= list.length) return p;
    [list[i], list[j]] = [list[j], list[i]];
    return setEffects(p, host, list);
  });
  return (
    <div className={`fx-card ${fx.enabled ? '' : 'off'}`}>
      <div className="row">
        <input type="checkbox" checked={fx.enabled} title="Bypass" onChange={(e) => edit((x) => ({ ...x, enabled: e.target.checked }), fx.enabled ? 'Bypass effect' : 'Enable effect')} />
        <b className="grow" title={def.description}>{def.name}</b>
        <button className="btn sm ghost" disabled={index === 0} onClick={() => move(-1)} title="Move earlier">◀</button>
        <button className="btn sm ghost" disabled={index === count - 1} onClick={() => move(1)} title="Move later">▶</button>
        <button className="btn sm ghost" title="Remove" onClick={() => st().commit('Remove effect', (p) => setEffects(p, host, getEffects(p, host).filter((e) => e.id !== fx.id)))}>✕</button>
      </div>
      <div className="knob-group">
        {def.params.map((pd) => (
          <Knob key={pd.key} label={pd.label} value={Number(fx.params[pd.key] ?? pd.default)} min={pd.min} max={pd.max} log={pd.log} def={pd.default}
            format={(v) => fmt(v, pd.unit)} onStart={() => st().beginGesture()} onEnd={() => st().endGesture(`${def.name} ${pd.label}`)}
            onChange={(v) => edit((x) => ({ ...x, params: { ...x.params, [pd.key]: pd.step ? Math.round(v / pd.step) * pd.step : v } }))} />
        ))}
      </div>
      {(def.choices ?? []).map((c) => (
        <label key={c.key} className="row small">{c.label}
          <select className="input grow" style={{ height: 22 }} value={String(fx.params[c.key] ?? c.default)} onChange={(e) => edit((x) => ({ ...x, params: { ...x.params, [c.key]: e.target.value } }), `${def.name} ${c.label}`)}>
            {c.key === 'source' ? [<option key="" value="">— choose trigger track —</option>, ...tracks.filter((t) => host.kind !== 'track' || t.id !== host.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)] : c.options.map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
      ))}
      {(def.toggles ?? []).map((t) => (
        <label key={t.key} className="row small"><input type="checkbox" checked={Boolean(fx.params[t.key] ?? t.default)} onChange={(e) => edit((x) => ({ ...x, params: { ...x.params, [t.key]: e.target.checked } }), `${def.name} ${t.label}`)} />{t.label}</label>
      ))}
    </div>
  );
}

export function EffectsRack({ host }: { host: FxHost }) {
  const effects = useStudio((s) => getEffects(s.project, host));
  const add = (type: EffectType, params = {}) => useStudio.getState().commit(`Add ${EFFECT_DEFS[type].name}`, (p) => {
    const list = getEffects(p, host);
    const fx = makeEffect(type, params);
    if (type === 'ducking' && !fx.params.source) fx.params.source = p.tracks.find((t) => t.role === 'drums')?.id ?? '';
    const li = list.findIndex((e) => e.type === 'limiter');
    return setEffects(p, host, type !== 'limiter' && li >= 0 ? [...list.slice(0, li), fx, ...list.slice(li)] : [...list, fx]);
  });
  return (
    <div className="col">
      <div className="row wrap">
        <select className="input" value="" onChange={(e) => { if (e.target.value) add(e.target.value as EffectType); }} aria-label="Add effect">
          <option value="">+ Add effect…</option>
          {Object.values(EFFECT_DEFS).map((d) => <option key={d.type} value={d.type}>{d.name}</option>)}
        </select>
        <select className="input" value="" onChange={(e) => { const pr = EFFECT_PRESETS[Number(e.target.value)]; if (pr) add(pr.type, pr.params); }} aria-label="Add effect preset">
          <option value="">+ Preset…</option>
          {EFFECT_PRESETS.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}
        </select>
        <span className="dim small">Signal flows left → right. Every effect processes audio in playback and export.</span>
      </div>
      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        {effects.length ? effects.map((fx, i) => <EffectCard key={fx.id} fx={fx} host={host} index={i} count={effects.length} />) : <div className="dim small">No effects on this channel.</div>}
      </div>
    </div>
  );
}
