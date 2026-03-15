const STORAGE_PREFIX = "guerrilla-studio:data";

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}:${projectId}`;
}

/** In-memory buffer for the last loaded project (avoid re-parsing on rapid successive ops). */
const store: Record<string, unknown> = {};
let loadedProjectId: string | null = null;

function loadFromStorage(projectId: string): void {
  if (typeof window === "undefined") return;
  for (const key of Object.keys(store)) delete store[key];
  loadedProjectId = projectId;
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        Object.assign(store, parsed);
      }
    }
  } catch {
    // ignore
  }
}

function saveToStorage(projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(store));
  } catch {
    // ignore
  }
}

export function addData(projectId: string, key: string, value: unknown): void {
  if (loadedProjectId !== projectId) loadFromStorage(projectId);
  store[key] = value;
  saveToStorage(projectId);
}

export function getData(projectId: string, key: string): unknown {
  if (loadedProjectId !== projectId) loadFromStorage(projectId);
  return store[key];
}

export function removeData(projectId: string, key: string): void {
  if (loadedProjectId !== projectId) loadFromStorage(projectId);
  delete store[key];
  saveToStorage(projectId);
}

export function removeAll(projectId: string): void {
  if (loadedProjectId !== projectId) loadFromStorage(projectId);
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  saveToStorage(projectId);
}

export function getAll(projectId: string): Record<string, unknown> {
  if (loadedProjectId !== projectId) loadFromStorage(projectId);
  return { ...store };
}
