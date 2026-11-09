/**
 * Application state (zustand). The project is immutable; every edit goes through
 * `commit` (undoable) or a gesture (begin → live updates → end = one undo step).
 * The audio engine and autosave subscribe to project changes.
 */
import { create } from 'zustand';
import { newProject, projectEndBeat } from '../model/factory';
import type { Project } from '../model/schema';
import { engine } from '../audio/engine';
import { listProjects, saveProject, type ProjectMeta } from '../storage/db';
import { DEFAULT_SETTINGS } from '../compose/composer';
import type { GenerationSettings } from '../model/schema';

export type BottomTab = 'editor' | 'mixer' | 'instrument' | 'automation' | 'vocals' | 'master';
export type LeftTab = 'instruments' | 'samples' | 'effects' | 'projects';
export type RightTab = 'generate' | 'chat';
export type Tool = 'select' | 'draw' | 'erase' | 'split';

export interface Toast { id: number; kind: 'info' | 'error' | 'success' | 'warn'; text: string }
export interface ChatMsg { role: 'user' | 'assistant'; text: string; applied?: string[]; errors?: string[]; engine?: 'claude' | 'local' }

interface HistoryEntry { project: Project; label: string }

export interface StudioState {
  project: Project;
  past: HistoryEntry[];
  future: HistoryEntry[];
  gestureBase: Project | null;
  // selection
  selection: { from: number; to: number } | null;
  selectedTrackIds: string[];
  selectedClipIds: string[];
  editClipId: string | null;
  // view
  zoom: number; // px per beat
  snap: boolean;
  grid: number; // beats
  tool: Tool;
  bottomTab: BottomTab;
  leftTab: LeftTab;
  rightTab: RightTab;
  panels: { left: number; right: number; bottom: number; leftOpen: boolean; rightOpen: boolean; bottomOpen: boolean };
  mode: 'studio' | 'beginner';
  automationTarget: string;
  // transport mirror
  playing: boolean;
  recording: boolean;
  cursorBeat: number;
  // misc
  toasts: Toast[];
  saveState: { status: 'idle' | 'saving' | 'saved' | 'error'; message?: string; at?: number };
  recent: ProjectMeta[];
  genSettings: GenerationSettings;
  chat: ChatMsg[];
  busy: string | null;
  clipboard: { kind: 'clips' | 'notes'; data: unknown } | null;

  // actions
  commit: (label: string, fn: (p: Project) => Project) => void;
  beginGesture: () => void;
  live: (fn: (p: Project) => Project) => void;
  endGesture: (label: string) => void;
  cancelGesture: () => void;
  undo: () => void;
  redo: () => void;
  load: (p: Project, label?: string, keepHistory?: boolean) => void;
  set: (partial: Partial<StudioState>) => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
  refreshRecent: () => Promise<void>;
}

const MAX_HISTORY = 150;
let toastId = 1;

export const useStudio = create<StudioState>((set, get) => ({
  project: newProject(),
  past: [],
  future: [],
  gestureBase: null,
  selection: null,
  selectedTrackIds: [],
  selectedClipIds: [],
  editClipId: null,
  zoom: 28,
  snap: true,
  grid: 1,
  tool: 'select',
  bottomTab: 'editor',
  leftTab: 'instruments',
  rightTab: 'generate',
  panels: { left: 250, right: 360, bottom: 300, leftOpen: true, rightOpen: true, bottomOpen: true },
  mode: 'studio',
  automationTarget: 'volume',
  playing: false,
  recording: false,
  cursorBeat: 0,
  toasts: [],
  saveState: { status: 'idle' },
  recent: [],
  genSettings: { ...DEFAULT_SETTINGS, prompt: '', seed: Math.floor(Math.random() * 1e6) },
  chat: [],
  busy: null,
  clipboard: null,

  commit: (label, fn) => {
    const cur = get().project;
    let next: Project;
    try {
      next = fn(cur);
    } catch (e) {
      get().toast('error', `${label} failed: ${(e as Error).message}`);
      return;
    }
    if (next === cur) return;
    next = { ...next, updatedAt: Date.now() };
    set({ project: next, past: [...get().past, { project: cur, label }].slice(-MAX_HISTORY), future: [] });
  },
  beginGesture: () => set({ gestureBase: get().project }),
  live: (fn) => set({ project: fn(get().project) }),
  endGesture: (label) => {
    const base = get().gestureBase;
    if (!base) return;
    const cur = get().project;
    set({ gestureBase: null });
    if (cur === base) return;
    set({ project: { ...cur, updatedAt: Date.now() }, past: [...get().past, { project: base, label }].slice(-MAX_HISTORY), future: [] });
  },
  cancelGesture: () => {
    const base = get().gestureBase;
    if (base) set({ project: base, gestureBase: null });
  },
  undo: () => {
    const { past, project, future } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({ project: prev.project, past: past.slice(0, -1), future: [{ project, label: prev.label }, ...future] });
    get().toast('info', `Undo: ${prev.label}`);
  },
  redo: () => {
    const { past, project, future } = get();
    const nxt = future[0];
    if (!nxt) return;
    set({ project: nxt.project, future: future.slice(1), past: [...past, { project, label: nxt.label }] });
    get().toast('info', `Redo: ${nxt.label}`);
  },
  load: (p, label = 'Open project', keepHistory = false) => {
    const cur = get().project;
    set({
      project: p,
      past: keepHistory ? [...get().past, { project: cur, label }].slice(-MAX_HISTORY) : [],
      future: [],
      selection: null, selectedClipIds: [], selectedTrackIds: p.tracks[0] ? [p.tracks[0].id] : [], editClipId: null,
      genSettings: p.generation ? { ...p.generation } : get().genSettings,
    });
  },
  set: (partial) => set(partial),
  toast: (kind, text) => {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-4), { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  refreshRecent: async () => set({ recent: await listProjects() }),
}));

// ---------- engine sync ----------
let rafPending = false;
useStudio.subscribe((s, prev) => {
  if (s.project === prev.project) return;
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    engine.setProject(useStudio.getState().project);
  });
});

// ---------- autosave ----------
let saveTimer: ReturnType<typeof setTimeout> | null = null;
export async function saveNow(): Promise<boolean> {
  const p = useStudio.getState().project;
  useStudio.setState({ saveState: { status: 'saving' } });
  try {
    await saveProject(p, { id: p.id, name: p.name, updatedAt: p.updatedAt, createdAt: p.createdAt, bpm: p.bpm, tracks: p.tracks.length, durationBeats: projectEndBeat(p) });
    useStudio.setState({ saveState: { status: 'saved', at: Date.now() } });
    return true;
  } catch (e) {
    useStudio.setState({ saveState: { status: 'error', message: (e as Error).message } });
    useStudio.getState().toast('error', (e as Error).message);
    return false;
  }
}
useStudio.subscribe((s, prev) => {
  if (s.project === prev.project || s.gestureBase) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveNow(); }, 1200);
});
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { if (saveTimer) { clearTimeout(saveTimer); void saveNow(); } });
}

export const getProject = () => useStudio.getState().project;
export const commit = (label: string, fn: (p: Project) => Project) => useStudio.getState().commit(label, fn);
export const toast = (kind: Toast['kind'], text: string) => useStudio.getState().toast(kind, text);
