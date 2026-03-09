import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const MIME_TO_EXT: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/webm": ".webm",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/flac": ".flac",
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const projectId = formData.get("projectId") as string | null;
    const clipId = formData.get("clipId") as string | null;

    if (!file || !projectId || !clipId) {
      return NextResponse.json(
        { error: "Missing file, projectId, or clipId" },
        { status: 400 }
      );
    }

    const ext =
      MIME_TO_EXT[file.type] ||
      (file.name ? path.extname(file.name) : ".mp4") ||
      ".mp4";
    const safeClipId = clipId.replace(/[^a-zA-Z0-9-_]/g, "_");
    const fileName = `${safeClipId}${ext}`;

    const dir = path.join(process.cwd(), "public", "editor-saves", projectId);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, fileName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    const publicPath = `/editor-saves/${projectId}/${fileName}`;
    return NextResponse.json({ path: publicPath });
  } catch (error) {
    console.error("Editor save blob error:", error);
    return NextResponse.json(
      { error: "Failed to save blob" },
      { status: 500 }
    );
  }
}
