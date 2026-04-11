import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

const LOCAL_IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
]);

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  return "image/png";
}

/**
 * Map a user-provided path to a filesystem path that must stay under
 * `public/projects/<projectId>/` (defense against arbitrary file read).
 */
function resolveAllowedPath(projectId: string, inputPath: string): string | null {
  const trimmed = inputPath.trim();
  if (!trimmed) return null;

  let candidate: string;
  if (trimmed.startsWith("/projects/")) {
    const rel = trimmed.replace(/^\/+/, "");
    candidate = path.resolve(process.cwd(), "public", rel);
  } else if (trimmed.startsWith("projects/")) {
    candidate = path.resolve(process.cwd(), "public", trimmed);
  } else if (/^file:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      candidate = path.resolve(decodeURIComponent(u.pathname));
    } catch {
      return null;
    }
  } else {
    candidate = path.resolve(trimmed);
  }

  const root = path.resolve(process.cwd(), "public", "projects", projectId);
  const resolved = path.resolve(candidate);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return resolved;
}

/**
 * Fallback for absolute paths outside `public/projects/<id>/` (e.g. Electron `File.path`).
 * Only common image extensions; same trust model as `upload-from-path` for local dev.
 */
function resolveLocalImagePathFallback(inputPath: string): string | null {
  const trimmed = inputPath.trim();
  if (!trimmed) return null;

  let candidate: string;
  if (/^file:\/\//i.test(trimmed)) {
    try {
      candidate = path.resolve(decodeURIComponent(new URL(trimmed).pathname));
    } catch {
      return null;
    }
  } else {
    candidate = path.resolve(trimmed);
  }

  const ext = path.extname(candidate).toLowerCase();
  if (!LOCAL_IMAGE_EXT.has(ext)) return null;
  return candidate;
}

/**
 * POST JSON: { projectId: string, paths: string[] }
 * Returns: { dataUrls: string[] } in the same order (data:image/...;base64,...).
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const o = body as { projectId?: string; paths?: unknown };
  const projectId = typeof o.projectId === "string" ? o.projectId.trim() : "";
  const paths = Array.isArray(o.paths)
    ? o.paths.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : [];

  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }
  if (paths.length === 0) {
    return NextResponse.json({ error: "paths is required" }, { status: 400 });
  }

  const dataUrls: string[] = [];

  for (const p of paths) {
    const fsPath = resolveAllowedPath(projectId, p) ?? resolveLocalImagePathFallback(p);
    if (!fsPath) {
      return NextResponse.json(
        {
          error: `Path not allowed or unreadable (use files under this project or local image paths): ${p.length > 120 ? `${p.slice(0, 120)}…` : p}`,
        },
        { status: 403 }
      );
    }
    try {
      const buf = await readFile(fsPath);
      const mime = mimeFromPath(fsPath);
      dataUrls.push(`data:${mime};base64,${buf.toString("base64")}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: `Failed to read ${path.basename(fsPath)}: ${msg}` },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ dataUrls });
}
