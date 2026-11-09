/**
 * AudioWorklet processors (inlined as source so they work identically in dev,
 * production builds, and OfflineAudioContext renders).
 */

const LIMITER = /* js */ `
class AimsLimiter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'inputGain', defaultValue: 1, minValue: 0, maxValue: 64, automationRate: 'k-rate' },
      { name: 'ceiling', defaultValue: 0.891, minValue: 0.01, maxValue: 1, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.12, minValue: 0.005, maxValue: 2, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.L = Math.max(16, Math.round(sampleRate * 0.005)); // 5 ms look-ahead
    this.bufL = new Float32Array(this.L); this.bufR = new Float32Array(this.L);
    this.box = new Float32Array(this.L); this.boxSum = this.L; this.box.fill(1);
    this.dq = new Int32Array(this.L * 2 + 4); this.dqv = new Float32Array(this.L * 2 + 4);
    this.head = 0; this.tail = 0; this.n = 0; this.pos = 0; this.r = 1; this.minGr = 1; this.frames = 0;
  }
  process(inputs, outputs, params) {
    const inp = inputs[0]; const out = outputs[0];
    if (!out || !out.length) return true;
    const iL = inp && inp[0] ? inp[0] : null; const iR = inp && inp[1] ? inp[1] : iL;
    const oL = out[0]; const oR = out[1] || out[0];
    const g = params.inputGain[0]; const ceil = params.ceiling[0];
    const rel = 1 - Math.exp(-1 / (params.release[0] * sampleRate));
    const L = this.L; const cap = this.dq.length;
    for (let i = 0; i < oL.length; i++) {
      const xl = iL ? iL[i] * g : 0; const xr = iR ? iR[i] * g : 0;
      const pk = Math.max(Math.abs(xl), Math.abs(xr));
      const need = pk > ceil ? ceil / pk : 1;
      // sliding-window minimum (monotonic deque) over the look-ahead window
      const n = this.n++;
      while (this.tail !== this.head && this.dqv[(this.tail - 1 + cap) % cap] >= need) this.tail = (this.tail - 1 + cap) % cap;
      this.dq[this.tail] = n; this.dqv[this.tail] = need; this.tail = (this.tail + 1) % cap;
      while (this.dq[this.head] <= n - L) this.head = (this.head + 1) % cap;
      const hold = this.dqv[this.head];
      // instant attack to the held minimum, exponential release
      this.r = hold < this.r ? hold : this.r + (hold - this.r) * rel;
      // box-average over the window => smooth attack that still reaches the needed gain at the peak
      const p = this.pos;
      this.boxSum += this.r - this.box[p]; this.box[p] = this.r;
      const gain = Math.min(1, this.boxSum / L);
      const dl = this.bufL[p]; const dr = this.bufR[p];
      this.bufL[p] = xl; this.bufR[p] = xr;
      this.pos = p + 1 === L ? 0 : p + 1;
      let yl = dl * gain, yr = dr * gain;
      // final safety clip (should practically never engage)
      if (yl > ceil) yl = ceil; else if (yl < -ceil) yl = -ceil;
      if (yr > ceil) yr = ceil; else if (yr < -ceil) yr = -ceil;
      oL[i] = yl; if (out[1]) oR[i] = yr;
      if (gain < this.minGr) this.minGr = gain;
    }
    if (++this.frames % 16 === 0) { this.port.postMessage(this.minGr); this.minGr = 1; }
    return true;
  }
}
registerProcessor('aims-limiter', AimsLimiter);
`;

const GATE = /* js */ `
class AimsGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -50, minValue: -120, maxValue: 0, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 0.002, minValue: 0.0001, maxValue: 1, automationRate: 'k-rate' },
      { name: 'hold', defaultValue: 0.05, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.1, minValue: 0.001, maxValue: 3, automationRate: 'k-rate' },
      { name: 'range', defaultValue: -80, minValue: -120, maxValue: 0, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.env = 0; this.g = 0; this.holdLeft = 0; }
  process(inputs, outputs, p) {
    const inp = inputs[0]; const out = outputs[0];
    if (!out || !out.length) return true;
    const thr = Math.pow(10, p.threshold[0] / 20);
    const floor = Math.pow(10, p.range[0] / 20);
    const att = 1 - Math.exp(-1 / (p.attack[0] * sampleRate));
    const rel = 1 - Math.exp(-1 / (p.release[0] * sampleRate));
    const envRel = 1 - Math.exp(-1 / (0.01 * sampleRate));
    const holdS = p.hold[0] * sampleRate;
    const chs = out.length;
    for (let i = 0; i < out[0].length; i++) {
      let pk = 0;
      for (let c = 0; c < chs; c++) { const x = inp && inp[c] ? Math.abs(inp[c][i]) : (inp && inp[0] ? Math.abs(inp[0][i]) : 0); if (x > pk) pk = x; }
      this.env = pk > this.env ? pk : this.env + (pk - this.env) * envRel;
      let target;
      if (this.env >= thr) { target = 1; this.holdLeft = holdS; }
      else if (this.holdLeft > 0) { target = 1; this.holdLeft--; }
      else target = floor;
      this.g += (target - this.g) * (target > this.g ? att : rel);
      for (let c = 0; c < chs; c++) {
        const src = inp && inp[c] ? inp[c] : (inp && inp[0] ? inp[0] : null);
        out[c][i] = src ? src[i] * this.g : 0;
      }
    }
    return true;
  }
}
registerProcessor('aims-gate', AimsGate);
`;

const RECORDER = /* js */ `
class AimsRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false; this.chunk = []; this.frames = 0; this.startFrame = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.on = true; this.chunk = []; this.frames = 0; }
      else if (e.data === 'stop') { this.flush(); this.on = false; this.port.postMessage({ done: true }); }
    };
  }
  flush() {
    if (!this.chunk.length) return;
    const chs = this.chunk[0].length;
    const out = [];
    for (let c = 0; c < chs; c++) {
      const arr = new Float32Array(this.frames);
      let o = 0;
      for (const blk of this.chunk) { arr.set(blk[c], o); o += blk[c].length; }
      out.push(arr);
    }
    this.port.postMessage({ startFrame: this.startFrame, data: out }, out.map((a) => a.buffer));
    this.chunk = []; this.frames = 0;
  }
  process(inputs) {
    const inp = inputs[0];
    if (this.on && inp && inp.length) {
      if (!this.frames) this.startFrame = currentFrame;
      this.chunk.push(inp.map((ch) => ch.slice(0)));
      this.frames += inp[0].length;
      if (this.frames >= 8192) this.flush();
    }
    return true;
  }
}
registerProcessor('aims-recorder', AimsRecorder);
`;

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();
const ready = new WeakSet<BaseAudioContext>();

export function workletsReady(ctx: BaseAudioContext) {
  return ready.has(ctx);
}

/** Load all worklet processors into a context. Resolves false if AudioWorklet is unavailable. */
export function ensureWorklets(ctx: BaseAudioContext): Promise<boolean> {
  let p = loaded.get(ctx);
  if (p) return p;
  p = (async () => {
    try {
      if (!ctx.audioWorklet || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') return false;
      const url = URL.createObjectURL(new Blob([LIMITER, GATE, RECORDER], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      ready.add(ctx);
      return true;
    } catch (e) {
      console.warn('[AIMS] AudioWorklet unavailable, using native fallbacks', e);
      return false;
    }
  })();
  loaded.set(ctx, p);
  return p;
}
