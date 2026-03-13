const STORAGE_KEY = "guerrilla-studio:data";
const store: Record<string, unknown> = {};

function loadFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const key of Object.keys(store)) delete store[key];
        Object.assign(store, parsed);
      }
    }
  } catch {
    // ignore
  }
}

function saveToStorage(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

export function addData(key: string, value: unknown): void {
  loadFromStorage();
  store[key] = value;
  saveToStorage();
}

export function getData(key: string): unknown {
  loadFromStorage();
  return store[key];
}

export function removeData(key: string): void {
  loadFromStorage();
  delete store[key];
  saveToStorage();
}

export function removeAll(): void {
  loadFromStorage();
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  saveToStorage();
}

export function getAll(): Record<string, unknown> {
  loadFromStorage();
  return { ...store };
}
