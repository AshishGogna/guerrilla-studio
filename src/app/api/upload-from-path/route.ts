import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const projectId = body.projectId as string;
    let filePath = body.filePath as string;

    if (!projectId || typeof filePath !== "string" || !filePath.trim()) {
      return NextResponse.json(
        { error: "Missing projectId or filePath" },
        { status: 400 }
      );
    }

    filePath = filePath.trim();
    if (filePath.startsWith("file://")) {
      filePath = filePath.slice(7);
    }

    const buffer = await readFile(filePath);

    const uploadsDir = join(process.cwd(), "public", "projects", projectId);
    await mkdir(uploadsDir, { recursive: true });

    const baseName = filePath.split("/").pop() ?? "image";
    const ext = baseName.includes(".") ? baseName.split(".").pop() ?? "png" : "png";
    const fileName = `ref-${Date.now()}-${baseName}`;
    const destPath = join(uploadsDir, fileName);
    await writeFile(destPath, buffer);

    const publicPath = `projects/${projectId}/${fileName}`;
    return NextResponse.json({ filePath: publicPath });
  } catch (error) {
    console.error("Upload from path error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload from path" },
      { status: 500 }
    );
  }
}
