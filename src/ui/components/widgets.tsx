import { useEffect, useRef, useState, type ReactNode } from 'react';
import { engine } from '../../audio/engine';
import { useStudio } from '../../state/store';

/** Rotary knob: drag vertically (Shift = fine), wheel, double-click resets. */
export function Knob({ value, min, max, onChange, onStart, onEnd, label, format, log, def, size = 34 }: {
  value: number; min: number; max: number; onChange: (v: number) => void; onStart?: () => void; onEnd?: () => void;
  label?: string; format?: (v: number) => string; log?: boolean; def?: number; size?: number;
}) {
  const toN = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromN = (n: number) => { const c = Math.max(0, Math.min(1, n)); return log ? min * Math.pow(max / min, c) : min + c * (max - min); };
  const n = Math.max(0, Math.min(1, toN(value)));
  const a0 = -135, a1 = 135, ang = a0 + (a1 - a0) * n;
  const r = size / 2 - 3;
  const polar = (a: number) => [size / 2 + r * Math.sin((a * Math.PI) / 180), size / 2 - r * Math.cos((a * Math.PI) / 180)];
  const [sx, sy] = polar(a0), [ex, ey] = polar(ang);
  const large = ang - a0 > 180 ? 1 : 0;
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const startY = e.clientY, startN = n;
    onStart?.();
    const move = (ev: PointerEvent) => onChange(fromN(startN + (startY - ev.clientY) / (ev.shiftKey ? 600 : 150)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); onEnd?.(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="param" title={label}>
      <svg className="knob" width={size} height={size} onPointerDown={onPointerDown}
        onDoubleClick={() => { if (def !== undefined) { onStart?.(); onChange(def); onEnd?.(); } }}
        onWheel={(e) => { onStart?.(); onChange(fromN(n - Math.sign(e.deltaY) * 0.02)); onEnd?.(); }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="#14161b" stroke="#3a4050" strokeWidth="2" />
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`} fill="none" stroke="#ff8a3d" strokeWidth="3" strokeLinecap="round" />
        <line x1={size / 2} y1={size / 2} x2={ex} y2={ey} stroke="#e7e9ee" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {label && <span>{label}</span>}
      <span className="val">{format ? format(value) : value.toFixed(2)}</span>
    </div>
  );
}

/** Stereo peak/RMS meter driven by an analyser read function (requestAnimationFrame, no React renders). */
export function Meter({ read, width = 10, height = 120, vertical = true }: { read: () => [number, number, number, number]; width?: number; height?: number; vertical?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const hold = [0, 0];
    const holdT = [0, 0];
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = ref.current;
      if (!c) return;
      const g = c.getContext('2d')!;
      const [pl, pr, rl, rr] = read();
      const W = c.width, H = c.height;
      g.fillStyle = '#07080a';
      g.fillRect(0, 0, W, H);
      const db = (x: number) => (x <= 1e-6 ? -70 : 20 * Math.log10(x));
      const norm = (d: number) => Math.max(0, Math.min(1, (d + 60) / 63));
      const now = performance.now();
      [pl, pr].forEach((pk, i) => {
        const rms = i === 0 ? rl : rr;
        if (pk > hold[i] || now - holdT[i] > 1200) { hold[i] = pk; holdT[i] = now; }
        const bw = vertical ? W / 2 - 1 : W;
        const x = vertical ? i * (W / 2) : 0;
        const pN = norm(db(pk)), rN = norm(db(rms)), hN = norm(db(hold[i]));
        if (vertical) {
          const grad = g.createLinearGradient(0, H, 0, 0);
          grad.addColorStop(0, '#2fbf7f'); grad.addColorStop(0.75, '#e7d14a'); grad.addColorStop(0.92, '#ff8a3d'); grad.addColorStop(1, '#ff4d5e');
          g.fillStyle = '#1d3a2c';
          g.fillRect(x, H - H * pN, bw, H * pN);
          g.fillStyle = grad;
          g.fillRect(x, H - H * rN, bw, H * rN);
          g.fillStyle = hold[i] >= 0.999 ? '#ff4d5e' : '#e7e9ee';
          g.fillRect(x, H - H * hN - 1, bw, 2);
        } else {
          const y = i * (H / 2);
          g.fillStyle = '#2fbf7f';
          g.fillRect(0, y, W * rN, H / 2 - 1);
          g.fillStyle = '#e7e9ee';
          g.fillRect(W * hN, y, 2, H / 2 - 1);
        }
      });
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [read, vertical]);
  return <canvas ref={ref} width={width} height={height} style={{ width, height, borderRadius: 3 }} />;
}

/** Real-time frequency spectrum of the master output. */
export function Spectrum({ height = 120 }: { height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    let data: Float32Array<ArrayBuffer> | null = null;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = ref.current;
      const an = engine.analyser();
      if (!c) return;
      const W = (c.width = c.clientWidth * devicePixelRatio), H = (c.height = height * devicePixelRatio);
      const g = c.getContext('2d')!;
      g.fillStyle = '#07080a';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = '#1f232c';
      g.fillStyle = '#4b5266';
      g.font = `${10 * devicePixelRatio}px monospace`;
      for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
        const x = (Math.log10(f / 20) / Math.log10(20000 / 20)) * W;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
        g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 2, H - 3);
      }
      if (!an) return;
      if (!data || data.length !== an.frequencyBinCount) data = new Float32Array(an.frequencyBinCount);
      an.getFloatFrequencyData(data);
      const sr = an.context.sampleRate;
      g.beginPath();
      for (let x = 0; x < W; x += 2) {
        const f = 20 * Math.pow(1000, x / W);
        const bin = Math.min(data.length - 1, Math.round((f / (sr / 2)) * data.length));
        const v = Math.max(0, Math.min(1, (data[bin] + 100) / 90));
        const y = H - v * H;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.lineTo(W, H); g.lineTo(0, H); g.closePath();
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#ff8a3dcc'); grad.addColorStop(1, '#3dc6ff22');
      g.fillStyle = grad;
      g.fill();
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [height]);
  return <canvas ref={ref} style={{ width: '100%', height, display: 'block', borderRadius: 6 }} />;
}

/** Scrolling spectrogram of the master output. */
export function Spectrogram({ height = 120 }: { height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    let data: Uint8Array<ArrayBuffer> | null = null;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = ref.current;
      const an = engine.analyser();
      if (!c || !an) return;
      if (c.width !== c.clientWidth) { c.width = c.clientWidth; c.height = height; }
      const g = c.getContext('2d')!;
      if (!engine.playing) return;
      if (!data || data.length !== an.frequencyBinCount) data = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(data);
      g.drawImage(c, -1, 0);
      const H = c.height;
      for (let y = 0; y < H; y++) {
        const f = 20 * Math.pow(1000, 1 - y / H);
        const bin = Math.min(data.length - 1, Math.round((f / (an.context.sampleRate / 2)) * data.length));
        const v = data[bin] / 255;
        g.fillStyle = `hsl(${260 - v * 240}, 90%, ${v * 55}%)`;
        g.fillRect(c.width - 1, y, 1, 1);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [height]);
  return <canvas ref={ref} style={{ width: '100%', height, display: 'block', borderRadius: 6, background: '#000' }} />;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={wide ? { width: 'min(860px, 100%)' } : undefined} role="dialog" aria-label={title}>
        <div className="row"><h2 className="grow">{title}</h2><button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useStudio((s) => s.toasts);
  const dismiss = useStudio((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>{t.text}</div>)}
    </div>
  );
}

export interface MenuItem { label: string; onClick: () => void; disabled?: boolean }
export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('blur', close); };
  }, [menu]);
  const node = menu ? (
    <div className="ctxmenu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - menu.items.length * 32 - 10) }} onPointerDown={(e) => e.stopPropagation()}>
      {menu.items.map((it, i) => <button key={i} disabled={it.disabled} onClick={() => { setMenu(null); it.onClick(); }}>{it.label}</button>)}
    </div>
  ) : null;
  return { open: (e: { clientX: number; clientY: number }, items: MenuItem[]) => setMenu({ x: e.clientX, y: e.clientY, items }), node };
}

/** Drag handle for resizable panels. */
export function Splitter({ dir, onDrag }: { dir: 'v' | 'h'; onDrag: (delta: number) => void }) {
  return (
    <div className={dir === 'v' ? 'splitter-v' : 'splitter-h'} onPointerDown={(e) => {
      e.preventDefault();
      let last = dir === 'v' ? e.clientX : e.clientY;
      const move = (ev: PointerEvent) => { const cur = dir === 'v' ? ev.clientX : ev.clientY; onDrag(cur - last); last = cur; };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }} />
  );
}

export function fmtDb(v: number) { return v <= -69.9 ? '-∞' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`; }
export function fmtHz(v: number) { return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${Math.round(v)}`; }
