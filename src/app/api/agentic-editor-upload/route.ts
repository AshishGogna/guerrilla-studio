import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export const maxDuration = 3600;

function safeName(name: string): string {
  const base = path.basename(name || "file");
  return base.replace(/[^\w.\-()+\s]/g, "_");
}

/**
 * POST multipart/form-data:
 * - projectId: string
 * - files: File[] (field name "files")
 *
 * Saves files under `public/projects/<projectId>/agentic-editor/<batchId>/...`
 * and returns absolute filesystem paths.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const projectIdRaw = form.get("projectId");
  const projectId = typeof projectIdRaw === "string" ? projectIdRaw.trim() : "";
  if (!projectId) {
    return Response.json({ error: "projectId is required" }, { status: 400 });
  }

  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return Response.json({ error: "No files provided" }, { status: 400 });
  }

  const batchId = randomUUID();
  const outDir = path.join(process.cwd(), "public", "projects", projectId, "agentic-editor", batchId);
  await mkdir(outDir, { recursive: true });

  const absPaths: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const name = safeName(f.name || `file-${i}`);
    const bytes = await f.arrayBuffer();
    const buf = Buffer.from(bytes);
    const abs = path.join(outDir, name);
    await writeFile(abs, buf);
    absPaths.push(abs);
  }

  return Response.json({ ok: true, batchId, absPaths });
}

