import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export async function POST(req: Request) {
  let localInputPath = "";
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

    const id = randomUUID();
    const tempDir = path.join(process.cwd(), "tmp");
    const outputDir = path.join(process.cwd(), "public", "upscaled_outputs");

    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });

    localInputPath = path.join(tempDir, `${id}_in.mp4`);
    const outputFileName = `${id}_out.mp4`;
    const finalOutputPath = path.join(outputDir, outputFileName);

    await fs.copyFile(inputFilePath, localInputPath);

    const RVE_PATH = "/Users/gogna/AG/MediaMogul/REAL-Video-Enhancer";
    const PYTHON_BIN = ".venv/bin/python"; 
    const SCRIPT_PATH = "backend/rve-backend.py"; 
    
    // Use absolute path for the model to avoid any 'relative path' confusion
    const MODEL_REL_PATH = "models/4xNomos8k_span_otf_weak_no_update_params.pth";

    const cmd = `${PYTHON_BIN} ${SCRIPT_PATH} \
      --input "${localInputPath}" \
      --output "${finalOutputPath}" \
      --device mps \
      --tilesize 512 \
      --upscale_model "${MODEL_REL_PATH}"`;
    
    await new Promise((resolve, reject) => {
      // exec uses the RVE_PATH context, making relative bin/ffmpeg paths work
      exec(cmd, { 
        cwd: RVE_PATH, 
        maxBuffer: 1024 * 1024 * 50 // 50MB buffer for longer logs
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
      details: err.message 
    }, { status: 500 });

  } finally {
    const id = ""; // placeholder as id is scoped to the try block
    try { 
      await fs.unlink(localInputPath); 
    //   await fs.unlink(outputPath); 
    } catch {}

    // 4. Cleanup the temporary COPIED input file
    // We do NOT delete the inputFilePath (original) or finalOutputPath
    // Note: To properly clean up in finally, move localInputPath declaration above try
  }
}