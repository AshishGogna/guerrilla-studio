import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const filePathParam = body.filePath ?? body.inputFilePath;
    if (!filePathParam || typeof filePathParam !== "string") {
      return Response.json({ error: "No file path provided" }, { status: 400 });
    }
    // Resolve path: if it looks like a web path (e.g. /editor-saves/...), resolve under public
    const inputFilePath = filePathParam.startsWith("/")
      ? path.join(process.cwd(), "public", filePathParam.replace(/^\//, ""))
      : filePathParam;

    const outputFileName = path.basename(filePathParam);
    const outputDir = path.join(process.cwd(), "public", "upscaled_outputs");
    const finalOutputPath = path.join(outputDir, outputFileName);

    await fs.mkdir(outputDir, { recursive: true });

    // If output already exists, return existing file paths without running upscale
    try {
      await fs.access(finalOutputPath);
      const outputPath = `/upscaled_outputs/${outputFileName}`;
      return Response.json({
        success: true,
        originalFile: filePathParam,
        upscaledFile: finalOutputPath,
        outputPath,
      });
    } catch {
      // File does not exist, proceed with upscale
    }

    const RVE_PATH = "/Users/gogna/AG/MediaMogul/REAL-Video-Enhancer";
    const PYTHON_BIN = ".venv/bin/python";
    const SCRIPT_PATH = "backend/rve-backend.py";
    const MODEL_REL_PATH = "models/4xNomos8k_span_otf_weak_no_update_params.pth";

    const cmd = `${PYTHON_BIN} ${SCRIPT_PATH} \
      --input "${inputFilePath}" \
      --output "${finalOutputPath}" \
      --device mps \
      --upscale_model "${MODEL_REL_PATH}"`;

    await new Promise((resolve, reject) => {
      exec(cmd, {
        cwd: RVE_PATH,
        maxBuffer: 1024 * 1024 * 50,
      }, (error, stdout, stderr) => {
        if (error) {
          console.error("RVE Error:", stderr);
          return reject(error);
        }
        console.log("RVE Output:", stdout);
        resolve(stdout);
      });
    });

    const outputPath = `/upscaled_outputs/${outputFileName}`;
    return Response.json({
      success: true,
      originalFile: filePathParam,
      upscaledFile: finalOutputPath,
      outputPath,
    });
  } catch (err: any) {
    console.error("Full Error:", err);
    return Response.json({
      error: "Upscale failed",
      details: err.message,
    }, { status: 500 });
  }
}