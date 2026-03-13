const store: Record<string, unknown> = {};

export function addData(key: string, value: unknown): void {
  store[key] = value;
}

export function getData(key: string): unknown {
  return store[key];
}

export function removeData(key: string): void {
  delete store[key];
}

export function removeAll(): void {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
}

export function getAll(): Record<string, unknown> {
  return { ...store };
}
