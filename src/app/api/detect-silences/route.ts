import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

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

export async function POST(req: Request) {
  const formData = await req.formData();
  const audio = formData.get("file") as File | null;

  if (!audio) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await audio.arrayBuffer());

  const ext = MIME_TO_EXT[audio.type] || path.extname(audio.name) || ".mp4";
  const id = randomUUID();
  const tempDir = path.join(process.cwd(), "tmp");
  await fs.mkdir(tempDir, { recursive: true });

  const audioPath = path.join(tempDir, `${id}${ext}`);

  try {
    await fs.writeFile(audioPath, buffer);

    const silences = await new Promise<{ start: number; end: number }[]>(
      (resolve, reject) => {
        const cmd = `ffmpeg -i "${audioPath}" -af silencedetect=noise=-45dB:d=0.5 -f null - 2>&1 | awk '/silence_start/ {s=$5} /silence_end/ {print s, $5}'`;

        exec(cmd, (error, stdout) => {
          if (error) return reject(error);

          const silences = stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const [start, end] = line.trim().split(/\s+/).map(Number);
              return { start, end };
            });

          resolve(silences);
        });
      }
    );

    return Response.json({ silences });

  } finally {
    try { await fs.unlink(audioPath); } catch {}
  }
}