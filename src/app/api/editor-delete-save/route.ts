import { NextRequest, NextResponse } from "next/server";
import { unlink } from "fs/promises";
import path from "path";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: publicPath } = body as { path?: string };

    if (!publicPath || typeof publicPath !== "string") {
      return NextResponse.json(
        { error: "Missing path" },
        { status: 400 }
      );
    }

    if (!publicPath.startsWith("/editor-saves/") || publicPath.includes("..")) {
      return NextResponse.json(
        { error: "Invalid path" },
        { status: 400 }
      );
    }

    const filePath = path.join(process.cwd(), "public", publicPath);
    await unlink(filePath).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to delete" },
      { status: 500 }
    );
  }
}
