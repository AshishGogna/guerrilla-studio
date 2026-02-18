import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { readFile } from "fs/promises";

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  let body: { prompt?: string; model?: string; outputFileName?: string, aspectRatio?: string, attachedImages?: {fileName: string; base64: string}[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt.trim()) {
    return NextResponse.json(
      { error: "prompt is required" },
      { status: 400 }
    );
  }

  const outputFileName = typeof body.outputFileName === "string" ? body.outputFileName : 0;

  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : "gemini-2.5-flash-image";

  const aspectRatio =
    typeof body.aspectRatio === "string" && body.aspectRatio.trim()
      ? body.aspectRatio.trim()
      : "16:9";

  // Process attached images
  const attachedImages = body.attachedImages || [];
  const refParts: any[] = [{ text: prompt }];

  for (const attachment of attachedImages) {
    // Extract the actual base64 data (remove data:image/png;base64, prefix)
    const base64Data = attachment.base64.split(',')[1];
    refParts.push({
      inline_data: {
        mime_type: "image/png",
        data: base64Data
      }
    });
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          parts: refParts
        }],
        generationConfig: {
          imageConfig: {"aspectRatio": aspectRatio}
        }
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const message =
        data?.error?.message ?? data?.message ?? `Gemini API error: ${res.status}`;
      return NextResponse.json({ error: message }, { status: res.status });
    }

    // Extract image data from Gemini response
    const candidates = data?.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return NextResponse.json(
        { error: "No candidates in Gemini response" },
        { status: 500 }
      );
    }

    const parts = candidates[0]?.content?.parts;
    if (!Array.isArray(parts)) {
      return NextResponse.json(
        { error: "No parts in Gemini response" },
        { status: 500 }
      );
    }

    // Look for image part
    const imagePart = parts.find(part => part.inlineData);
    if (!imagePart?.inlineData?.data) {
      return NextResponse.json(
        { error: "No image data in Gemini response" },
        { status: 500 }
      );
    }

    // Save image to file
    const imageData = imagePart.inlineData.data;
    const mimeType = imagePart.inlineData.mimeType || "image/png";
    const extension = mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : "png";
    
    // Create images directory if it doesn't exist
    const imagesDir = join(process.cwd(), "public", "images");
    try {
      await mkdir(imagesDir, { recursive: true });
    } catch {
      // Directory already exists, ignore
    }

    // Generate filename and save
    const filename = `${outputFileName}.${extension}`;
    const filePath = join(imagesDir, filename);
    
    // Convert base64 to buffer and save
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    await writeFile(filePath, buffer);

    // Return the public path
    return NextResponse.json({ 
      content: `/images/${filename}`
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
