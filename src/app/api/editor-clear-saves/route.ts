import { NextRequest, NextResponse } from "next/server";
import { readdir, unlink } from "fs/promises";
import path from "path";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId } = body as { projectId?: string };

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json(
        { error: "Missing projectId" },
        { status: 400 }
      );
    }

    const safeId = projectId.replace(/[^a-zA-Z0-9-_]/g, "");
    if (safeId !== projectId) {
      return NextResponse.json(
        { error: "Invalid projectId" },
        { status: 400 }
      );
    }

    const dir = path.join(process.cwd(), "public", "editor-saves", safeId);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isFile()) {
        await unlink(path.join(dir, e.name)).catch(() => {});
      }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to clear saves" },
      { status: 500 }
    );
  }
}
