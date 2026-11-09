/**
 * AIMS backend: keeps API keys off the client, proxies Claude for composition /
 * assistant / lyrics, bridges optional vocal/audio providers, and serves the built app.
 *
 * Env:
 *   ANTHROPIC_API_KEY      – enables Claude features (never sent to the browser)
 *   AIMS_MODEL             – default claude-opus-5-5
 *   AIMS_EFFORT            – low|medium|high (default medium)
 *   VOCAL_PROVIDER         – 'fishaudio' (spoken-word TTS) or 'http' (your singing-synthesis service)
 *   FISH_AUDIO_API_KEY     – for VOCAL_PROVIDER=fishaudio (FISH_AUDIO_VOICE_ID, FISH_AUDIO_MODEL optional)
 *   VOCAL_PROVIDER_URL     – for VOCAL_PROVIDER=http (see README for the request contract)
 *   PORT / API_PORT        – default 8787
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { CompositionSpecSchema } from '../src/compose/spec';
import { validateCommands } from '../src/ai/commands';
import { ASSIST_SYSTEM, COMPOSE_SYSTEM, LYRICS_SYSTEM } from './prompts';

const PORT = Number(process.env.PORT || process.env.API_PORT || 8787);
const MODEL = process.env.AIMS_MODEL || 'claude-opus-5-5';
const EFFORT = (process.env.AIMS_EFFORT || 'medium') as 'low' | 'medium' | 'high';
const DIST = resolve(process.cwd(), 'dist');
const hasClaude = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
let client: Anthropic | null = null;
const claude = () => (client ??= new Anthropic());

function vocalProvider() {
  const kind = (process.env.VOCAL_PROVIDER || '').toLowerCase();
  if (kind === 'fishaudio' && process.env.FISH_AUDIO_API_KEY) return { kind: 'fishaudio' as const, name: 'Fish Audio TTS', singing: false, speech: true };
  if (kind === 'http' && process.env.VOCAL_PROVIDER_URL) return { kind: 'http' as const, name: process.env.VOCAL_PROVIDER_NAME || 'External vocal provider', singing: true, speech: false };
  return null;
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(data);
}

async function readJson(req: http.IncomingMessage, limit = 3_000_000): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(c as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}

export function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fence ? fence[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(body);
}

/** One Claude call: streaming (long outputs), adaptive thinking (model default), server-side refusal fallback. */
async function ask(system: string, messages: Anthropic.Beta.BetaMessageParam[], maxTokens = 32000): Promise<string> {
  const stream = claude().beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages,
    output_config: { effort: EFFORT },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw Object.assign(new Error('Claude declined this request.'), { status: 422 });
  const text = msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n');
  if (msg.stop_reason === 'max_tokens' && !text.includes('}')) throw Object.assign(new Error('Claude response was cut off (max tokens).'), { status: 502 });
  return text;
}

/** Ask for JSON, validate, and give Claude one chance to repair validation errors. */
async function askValidated<T>(system: string, user: string, validate: (x: unknown) => { ok: true; value: T } | { ok: false; errors: string[] }): Promise<T> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: user }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await ask(system, messages);
    let parsed: unknown;
    let errors: string[];
    try {
      parsed = extractJson(text);
      const v = validate(parsed);
      if (v.ok) return v.value;
      errors = v.errors;
    } catch (e) {
      errors = [`Could not parse JSON: ${(e as Error).message}`];
    }
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: `That JSON failed validation:\n${errors.slice(0, 15).join('\n')}\nReturn the corrected complete JSON only.` });
  }
  throw Object.assign(new Error('Claude returned data that failed validation twice.'), { status: 502 });
}

function fail(res: http.ServerResponse, e: unknown) {
  const err = e as { status?: number; message?: string };
  let status = err.status ?? 500;
  let message = err.message ?? 'Server error';
  if (e instanceof Anthropic.AuthenticationError) { status = 401; message = 'The Anthropic API key was rejected.'; }
  else if (e instanceof Anthropic.RateLimitError) { status = 429; message = 'Claude rate limit reached – try again shortly.'; }
  else if (e instanceof Anthropic.APIError) { status = 502; message = `Claude API error: ${e.message}`; }
  send(res, status, { error: message });
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, path: string) {
  if (path === '/api/health' && req.method === 'GET') {
    const vp = vocalProvider();
    return send(res, 200, { ok: true, claude: hasClaude(), model: hasClaude() ? MODEL : null, vocalProvider: vp ? { name: vp.name, singing: vp.singing, speech: vp.speech } : null });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (path.startsWith('/api/ai/') && !hasClaude()) return send(res, 503, { error: 'Claude is not configured on the server. Set ANTHROPIC_API_KEY and restart. The local composer and assistant keep working.' });
  const body = await readJson(req);
  if (path === '/api/ai/compose') {
    const s = body.settings ?? {};
    const user = `Compose an original piece.\nRequest: ${String(s.prompt ?? '').slice(0, 4000)}\nControls: genre=${s.genre}, mood=${s.mood}, duration=${s.durationSec}s, bpm=${s.bpm || 'auto'}, key=${s.key}, vocals=${s.vocals}, complexity=${s.complexity}, energy=${s.energy}, creativity=${s.creativity}, instrumentation=${s.instrumentation}, structure=${s.structure}, seed=${s.seed}.\n${body.plan ? `A local draft plan you may improve on:\n${JSON.stringify(body.plan).slice(0, 20000)}` : ''}`;
    const spec = await askValidated(COMPOSE_SYSTEM, user, (x) => {
      const r = CompositionSpecSchema.safeParse(x);
      return r.success ? { ok: true as const, value: r.data } : { ok: false as const, errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
    });
    return send(res, 200, { spec });
  }
  if (path === '/api/ai/assist') {
    const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
    const user = `Project summary:\n${JSON.stringify(body.context).slice(0, 60000)}\n\nUser request: ${String(body.message ?? '').slice(0, 4000)}`;
    const result = await askValidated(ASSIST_SYSTEM, [...history.map((h: any) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${String(h.text).slice(0, 1000)}`), user].join('\n\n'), (x) => {
      const obj = x as { reply?: unknown; commands?: unknown };
      if (!obj || typeof obj !== 'object' || typeof obj.reply !== 'string') return { ok: false as const, errors: ['missing "reply" string'] };
      const v = validateCommands(obj.commands ?? []);
      if (v.errors.length && !v.commands.length && Array.isArray(obj.commands) && obj.commands.length) return { ok: false as const, errors: v.errors };
      return { ok: true as const, value: { reply: obj.reply, commands: v.commands, rejected: v.errors } };
    });
    return send(res, 200, result);
  }
  if (path === '/api/ai/lyrics') {
    const user = `Write lyrics. Mood: ${body.mood}. Topic: ${String(body.topic ?? '').slice(0, 500)}. Voice: ${body.voice}. Sections: ${JSON.stringify(body.sections).slice(0, 4000)}`;
    const out = await askValidated(LYRICS_SYSTEM, user, (x) => {
      const o = x as { sections?: { section: string; text: string }[] };
      return Array.isArray(o?.sections) && o.sections.every((s) => typeof s.section === 'string' && typeof s.text === 'string') ? { ok: true as const, value: o.sections } : { ok: false as const, errors: ['expected {"sections":[{"section","text"}]}'] };
    });
    return send(res, 200, { sections: out });
  }
  if (path === '/api/vocals/render') {
    const vp = vocalProvider();
    if (!vp) return send(res, 503, { error: 'No vocal provider is configured. Record a vocal, import one, or configure VOCAL_PROVIDER on the server (see README).' });
    if (vp.kind === 'fishaudio') {
      const text = String(body.text ?? '').slice(0, 3000);
      if (!text.trim()) return send(res, 400, { error: 'No text to speak' });
      const r = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY}`, 'content-type': 'application/json', ...(process.env.FISH_AUDIO_MODEL ? { model: process.env.FISH_AUDIO_MODEL } : {}) },
        body: JSON.stringify({ text, format: 'mp3', ...(process.env.FISH_AUDIO_VOICE_ID ? { reference_id: process.env.FISH_AUDIO_VOICE_ID } : {}) }),
      });
      if (!r.ok) return send(res, 502, { error: `Fish Audio error ${r.status}: ${(await r.text()).slice(0, 300)}` });
      res.writeHead(200, { 'content-type': r.headers.get('content-type') || 'audio/mpeg', 'x-aims-provider': 'fishaudio-tts', 'x-aims-kind': 'speech' });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    const r = await fetch(process.env.VOCAL_PROVIDER_URL!, { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.VOCAL_PROVIDER_TOKEN ? { authorization: `Bearer ${process.env.VOCAL_PROVIDER_TOKEN}` } : {}) }, body: JSON.stringify(body) });
    if (!r.ok) return send(res, 502, { error: `Vocal provider error ${r.status}` });
    res.writeHead(200, { 'content-type': r.headers.get('content-type') || 'audio/wav', 'x-aims-provider': 'http', 'x-aims-kind': 'singing' });
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  return send(res, 404, { error: 'Not found' });
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.map': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

async function serveStatic(res: http.ServerResponse, path: string) {
  const safe = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, safe);
  if (!file.startsWith(DIST)) return send(res, 403, { error: 'Forbidden' });
  try {
    const st = await stat(file);
    if (st.isDirectory()) file = join(file, 'index.html');
  } catch { file = join(DIST, 'index.html'); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Build not found. Run "npm run build" first, or use "npm run dev" during development.');
  }
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url.pathname);
    else await serveStatic(res, url.pathname);
  } catch (e) {
    if (!res.headersSent) fail(res, e);
    else res.end();
  }
});

if (process.env.AIMS_NO_LISTEN !== '1') {
  server.listen(PORT, () => {
    console.log(`[aims] API${process.env.NODE_ENV === 'production' ? ' + app' : ''} on http://localhost:${PORT}  claude=${hasClaude() ? MODEL : 'not configured'}  vocals=${vocalProvider()?.name ?? 'none'}`);
  });
}
