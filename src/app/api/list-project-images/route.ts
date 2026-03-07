import { NextRequest, NextResponse } from "next/server";
import { readdir } from "fs/promises";
import { join } from "path";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId") || "X";
  const dir = join(process.cwd(), "public", "projects", projectId);

  try {
    const files = await readdir(dir);
    const images = files
      .filter((f) => IMAGE_EXT.has(f.slice(f.lastIndexOf(".")).toLowerCase()))
      .map((f) => `/projects/${projectId}/${f}`);
    return NextResponse.json({ images });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return NextResponse.json({ images: [] });
    }
    console.error("list-project-images error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list images" },
      { status: 500 }
    );
  }
}
