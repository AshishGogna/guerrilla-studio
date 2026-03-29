import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

/** Allow long local Whisper runs (Vercel / Next may still cap by plan). */
export const maxDuration = 3600;

const MIME_TO_EXT: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/webm": ".webm",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/flac": ".flac",
  "audio/x-m4a": ".m4a",
};

function runWhisper(audioPath: string, outputDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "whisper",
      [
        audioPath,
        "--model",
        "medium",
        "--task",
        "transcribe",
        "--word_timestamps",
        "True",
        "--output_format",
        "json",
        "--output_dir",
        outputDir,
      ],
      {
        // Avoid child_process.exec default maxBuffer (~200KB) killing long Whisper runs.
        // Inherit stdout/stderr so progress still appears in the Next.js terminal.
        stdio: ["ignore", "inherit", "inherit"],
      }
    );

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `whisper exited with code ${code ?? "null"}${signal ? ` (signal ${signal})` : ""}`
        )
      );
    });
  });
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const audio = formData.get("audio") as File | null;

  if (!audio) {
    return Response.json({ error: "No audio file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await audio.arrayBuffer());
  console.log(
    "[whisper-clip] upload",
    buffer.length,
    "bytes",
    audio.type || "(type?)",
    audio.name || "(name?)"
  );

  const ext = MIME_TO_EXT[audio.type] || path.extname(audio.name) || ".mp4";
  const id = randomUUID();
  const tempDir = path.join(process.cwd(), "tmp");
  await fs.mkdir(tempDir, { recursive: true });

  const audioPath = path.join(tempDir, `${id}${ext}`);
  const jsonPath = path.join(tempDir, `${id}.json`);

  try {
    await fs.writeFile(audioPath, buffer);
    const t0 = Date.now();
    console.log("[whisper-clip] starting Whisper (may run many minutes for long audio)…");
    await runWhisper(audioPath, tempDir);
    console.log("[whisper-clip] Whisper done in", Date.now() - t0, "ms");

    const raw = await fs.readFile(jsonPath, "utf8");
    const result = JSON.parse(raw) as { segments?: unknown };
    const n = Array.isArray(result.segments) ? result.segments.length : 0;
    console.log("[whisper-clip] segments:", n);

    return Response.json(result);
  } catch (err) {
    console.error("[whisper-clip] error:", err);
    return Response.json(
      {
        error: err instanceof Error ? err.message : String(err),
        segments: [],
      },
      { status: 500 }
    );
  } finally {
    try {
      await fs.unlink(audioPath);
    } catch {
      // ignore
    }
    try {
      await fs.unlink(jsonPath);
    } catch {
      // ignore
    }
  }
}
