"use client";

import { generateImage } from "@/lib/ai";
import { useState } from "react";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const MODELS = ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"] as const;
const ASPECT_RATIOS = ["1:1", "16:9", "9:16"] as const;
const SCALES = ["1x", "2x"] as const;

export default function ImageGen() {
  const [model, setModel] = useState<typeof MODELS[number]>(MODELS[0]);
  const [aspectRatio, setAspectRatio] = useState<typeof ASPECT_RATIOS[number]>(ASPECT_RATIOS[0]);
  const [scale, setScale] = useState<typeof SCALES[number]>(SCALES[0]);
  const [referenceImages, setReferenceImages] = useState<Array<{ file: File; url: string }>>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  function handleRefImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    const newRefs = Array.from(files).map((f) => ({ file: f, url: URL.createObjectURL(f) }));
    referenceImages.forEach((r) => URL.revokeObjectURL(r.url));
    setReferenceImages(newRefs);
    e.target.value = "";
  }

  function removeRef(index: number) {
    setReferenceImages((prev) => {
      const next = prev.filter((_, i) => i !== index);
      URL.revokeObjectURL(prev[index].url);
      return next;
    });
  }

  async function handleGenerate() {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    try {
      const attachedImages = await Promise.all(
        referenceImages.map(async (ref) => ({
          fileName: ref.file.name,
          base64: await fileToBase64(ref.file),
        }))
      );
      const projectId = "image-gen";
      const fileName = `img-${Date.now()}`;
      const imagePath = await generateImage(
        prompt.trim(),
        projectId,
        fileName,
        aspectRatio,
        attachedImages.length > 0 ? attachedImages : undefined
      );
      setPreviewUrl(imagePath);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to generate image");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-1 overflow-hidden bg-background text-foreground">
      {/* Left box: controls */}
      <aside className="flex w-64 shrink-0 flex-col gap-4 border-r border-foreground/10 bg-background/50 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground/60">Image model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as typeof MODELS[number])}
            className="w-full rounded border border-foreground/10 bg-transparent px-3 py-2 text-sm"
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground/60">Aspect ratio</label>
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as typeof ASPECT_RATIOS[number])}
            className="w-full rounded border border-foreground/10 bg-transparent px-3 py-2 text-sm"
          >
            {ASPECT_RATIOS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground/60">Scale</label>
          <select
            value={scale}
            onChange={(e) => setScale(e.target.value as typeof SCALES[number])}
            className="w-full rounded border border-foreground/10 bg-transparent px-3 py-2 text-sm"
          >
            {SCALES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <input
            type="file"
            accept="image/*"
            multiple
            id="imagegen-refs"
            className="hidden"
            onChange={handleRefImages}
          />
          <button
            type="button"
            onClick={() => document.getElementById("imagegen-refs")?.click()}
            className="w-full rounded border border-foreground/20 px-3 py-2 text-sm text-foreground/80 hover:bg-foreground/5"
          >
            Attach reference images
          </button>
          {referenceImages.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {referenceImages.map((ref, i) => (
                <div key={i} className="relative">
                  <img src={ref.url} alt="" className="h-14 w-14 rounded object-cover" />
                  <button
                    type="button"
                    onClick={() => removeRef(i)}
                    className="absolute -right-1 -top-1 rounded-full bg-foreground/90 px-1.5 text-xs text-background"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Right: preview + prompt */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-6">
        <div className="flex min-h-0 flex-1 items-center justify-center rounded border border-foreground/10 bg-foreground/5">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Preview"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-sm text-foreground/40">Image preview</span>
          )}
        </div>
        <div className="relative mt-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Image prompt"
            className="min-h-[100px] w-full resize-none rounded border border-foreground/10 bg-transparent px-4 py-3 pr-28 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-1 focus:ring-accent/50"
            rows={4}
          />
          <button
            type="button"
            disabled={!prompt.trim() || isGenerating}
            onClick={handleGenerate}
            className="absolute right-3 bottom-3 flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-semibold text-background transition hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                Generating…
              </>
            ) : (
              "Generate"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
