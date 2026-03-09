import { exec } from "child_process";

export async function POST(req) {
  const { videoPath } = await req.json();

  return new Promise((resolve, reject) => {
    exec(
      `whisper ${videoPath} --model base --output_format json`,
      (error, stdout, stderr) => {
        if (error) return reject(error);

        resolve(
          Response.json({
            message: "transcription complete"
          })
        );
      }
    );
  });
}