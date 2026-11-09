/** IndexedDB persistence for projects and audio assets (via `idb`). */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Project } from '../model/schema';

export interface StoredAsset {
  id: string;
  name: string;
  mime: string;
  size: number;
  bytes: ArrayBuffer;
  createdAt: number;
  durationSec: number;
  kind: 'recording' | 'import' | 'sample' | 'render';
}
export interface ProjectMeta { id: string; name: string; updatedAt: number; createdAt: number; bpm: number; tracks: number; durationBeats: number }

interface AimsDB extends DBSchema {
  projects: { key: string; value: { id: string; meta: ProjectMeta; data: Project } };
  assets: { key: string; value: StoredAsset };
  meta: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<AimsDB>> | null = null;
export function db() {
  if (!dbp) {
    dbp = openDB<AimsDB>('aims-studio', 1, {
      upgrade(d) {
        d.createObjectStore('projects', { keyPath: 'id' });
        d.createObjectStore('assets', { keyPath: 'id' });
        d.createObjectStore('meta');
      },
    });
  }
  return dbp;
}

export class StorageError extends Error {
  constructor(message: string, public cause?: unknown) { super(message); }
}

function wrap(e: unknown, what: string): StorageError {
  const name = (e as any)?.name;
  if (name === 'QuotaExceededError') return new StorageError(`${what}: browser storage is full. Delete old projects/recordings or export your project to a file.`, e);
  return new StorageError(`${what}: ${(e as any)?.message ?? e}`, e);
}

export async function saveProject(p: Project, meta: ProjectMeta) {
  try {
    await (await db()).put('projects', { id: p.id, meta, data: p });
    await (await db()).put('meta', p.id, 'lastProjectId');
  } catch (e) { throw wrap(e, 'Could not save project'); }
}
export async function loadProject(id: string): Promise<Project | null> {
  try { return (await (await db()).get('projects', id))?.data ?? null; } catch (e) { throw wrap(e, 'Could not open project'); }
}
export async function deleteProject(id: string) { await (await db()).delete('projects', id); }
export async function listProjects(): Promise<ProjectMeta[]> {
  try {
    const all = await (await db()).getAll('projects');
    return all.map((r) => r.meta).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch { return []; }
}
export async function lastProjectId(): Promise<string | null> {
  try { return ((await (await db()).get('meta', 'lastProjectId')) as string) ?? null; } catch { return null; }
}
export async function putAsset(a: StoredAsset) {
  try { await (await db()).put('assets', a); } catch (e) { throw wrap(e, `Could not store audio "${a.name}"`); }
}
export async function getAsset(id: string): Promise<StoredAsset | undefined> {
  return (await db()).get('assets', id);
}
export async function listAssets(): Promise<Omit<StoredAsset, 'bytes'>[]> {
  const all = await (await db()).getAll('assets');
  return all.map(({ bytes: _b, ...rest }) => rest);
}
export async function deleteAsset(id: string) { await (await db()).delete('assets', id); }
export async function setMeta(key: string, value: unknown) { await (await db()).put('meta', value, key); }
export async function getMeta<T>(key: string): Promise<T | undefined> { return (await (await db()).get('meta', key)) as T | undefined; }

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch { return null; }
}
export async function requestPersistence() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
