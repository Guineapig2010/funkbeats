/** Browser client for the AIMS backend. No API keys ever live in the frontend. */
import type { GenerationSettings } from '../model/schema';
import { validateSpec, type CompositionSpec } from '../compose/spec';
import { validateCommands, type Command } from './commands';

export interface Health { ok: boolean; claude: boolean; model: string | null; vocalProvider: { name: string; singing: boolean; speech: boolean } | null }

let cached: Health | null = null;
export async function health(force = false): Promise<Health> {
  if (cached && !force) return cached;
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    cached = await r.json();
  } catch {
    cached = { ok: false, claude: false, model: null, vocalProvider: null };
  }
  return cached!;
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error('Could not reach the AIMS server. Start it with "npm run dev" (or "npm start").');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as any).error ?? `Server error ${r.status}`);
  return data as T;
}

export async function claudeCompose(settings: GenerationSettings, plan: CompositionSpec | null, signal?: AbortSignal): Promise<CompositionSpec> {
  const { spec } = await post<{ spec: unknown }>('/api/ai/compose', { settings, plan }, signal);
  // validate again on the client – never trust the network blindly
  const v = validateSpec(spec);
  if (!v.ok) throw new Error(`Claude's composition failed validation: ${v.errors.slice(0, 3).join('; ')}`);
  return v.spec;
}

export async function claudeAssist(message: string, context: unknown, history: { role: 'user' | 'assistant'; text: string }[], signal?: AbortSignal): Promise<{ reply: string; commands: Command[]; rejected: string[] }> {
  const res = await post<{ reply: string; commands: unknown[]; rejected?: string[] }>('/api/ai/assist', { message, context, history }, signal);
  const v = validateCommands(res.commands ?? []);
  return { reply: res.reply, commands: v.commands, rejected: [...(res.rejected ?? []), ...v.errors] };
}

export async function claudeLyrics(sections: { section: string; lines: number; kind: string }[], mood: string, topic: string, voice: string) {
  return (await post<{ sections: { section: string; text: string }[] }>('/api/ai/lyrics', { sections, mood, topic, voice })).sections;
}

export async function renderVocals(body: unknown): Promise<{ blob: Blob; kind: string; provider: string }> {
  const r = await fetch('/api/vocals/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as any).error ?? `Vocal provider error ${r.status}`);
  return { blob: await r.blob(), kind: r.headers.get('x-aims-kind') ?? 'unknown', provider: r.headers.get('x-aims-provider') ?? 'unknown' };
}
