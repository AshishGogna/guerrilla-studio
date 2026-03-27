import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

function nodesFilePath(projectId: string): string {
  return join(process.cwd(), "public", "projects", projectId, "nodes.json");
}

export async function saveNodesJson(projectId: string, data: unknown): Promise<void> {
  const filePath = nodesFilePath(projectId);
  const dir = join(process.cwd(), "public", "projects", projectId);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function loadNodesJson<T>(projectId: string): Promise<T | null> {
  const filePath = nodesFilePath(projectId);
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

