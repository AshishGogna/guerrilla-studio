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
  const audio = formData.get("audio") as File | null;

  if (!audio) {
    return Response.json({ error: "No audio file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await audio.arrayBuffer());

  const ext = MIME_TO_EXT[audio.type] || path.extname(audio.name) || ".mp4";
  const id = randomUUID();
  const tempDir = path.join(process.cwd(), "tmp");
  await fs.mkdir(tempDir, { recursive: true });

  const audioPath = path.join(tempDir, `${id}${ext}`);
  const jsonPath = path.join(tempDir, `${id}.json`);

  try {
    await fs.writeFile(audioPath, buffer);

    await new Promise<void>((resolve, reject) => {
      exec(
        `whisper ${audioPath} --model medium --task transcribe --word_timestamps True --output_format json --output_dir "${tempDir}"`,
        (error) => {
          if (error) reject(error);
          else resolve();
        }
      );
    });

    const result = JSON.parse(await fs.readFile(jsonPath, "utf8"));

    return Response.json(result);

  } finally {
    //Dont uncomment these two lines.
    try { await fs.unlink(audioPath); } catch {}
    try { await fs.unlink(jsonPath); } catch {}
  }
}