"use client";

import { useEffect, useState } from "react";

const MODELS = ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"] as const;
const ASPECTS = ["1:1", "16:9", "9:16"] as const;
const RESOLUTIONS = ["1k", "2k"] as const;

export default function ImageView() {
  const [model, setModel] = useState<typeof MODELS[number]>(MODELS[0]);
  const [aspect, setAspect] = useState<typeof ASPECTS[number]>(ASPECTS[0]);
  const [resolution, setResolution] = useState<typeof RESOLUTIONS[number]>(RESOLUTIONS[0]);
  const [refs, setRefs] = useState<Array<{ file: File; url: string }>>([]);
  const [prompt, setPrompt] = useState("");
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  useEffect(() => {
    return () => {
      // cleanup object URLs
      refs.forEach((r) => URL.revokeObjectURL(r.url));
    };
  }, [refs]);

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const arr = Array.from(files).map((f) => ({ file: f, url: URL.createObjectURL(f) }));
    // revoke previous urls
    refs.forEach((r) => URL.revokeObjectURL(r.url));
    setRefs(arr);
  }

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(String(reader.result));
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  return (
    <div className="w-full h-full bg-background text-foreground">
      <div className="max-w-full mx-auto h-full flex">
        {/* Left panel */}
        <aside className="w-80 border-r border-foreground/10 p-4 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-mono text-foreground/60 mb-1">Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value as typeof MODELS[number])}
              className="w-full rounded bg-background border border-foreground/10 px-2 py-2 text-sm"
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-mono text-foreground/60 mb-1">Aspect Ratio</label>
            <select
              value={aspect}
              onChange={(e) => setAspect(e.target.value as typeof ASPECTS[number])}
              className="w-full rounded bg-background border border-foreground/10 px-2 py-2 text-sm"
            >
              {ASPECTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-mono text-foreground/60 mb-1">Resolution</label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value as typeof RESOLUTIONS[number])}
              className="w-full rounded bg-background border border-foreground/10 px-2 py-2 text-sm"
            >
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 overflow-auto">
            <label className="block text-xs font-mono text-foreground/60 mb-1">Reference Images</label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleFiles}
              className="hidden"
              id="ref-files-input"
            />
            <div className="mb-3">
              <button
                type="button"
                onClick={() => document.getElementById("ref-files-input")?.click()}
                className="rounded bg-foreground/5 px-3 py-2 text-sm text-foreground/90 hover:bg-foreground/10"
              >
                Add images
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {refs.length === 0 ? (
                <div className="text-foreground/60 text-sm">No reference images uploaded.</div>
              ) : (
                refs.map((r, i) => (
                  <div key={i} className="relative w-40">
                    <img src={r.url} alt={`ref-${i}`} className="w-40 h-28 object-cover rounded" />
                    <button
                      type="button"
                      onClick={() => {
                        // remove this ref
                        setRefs((prev) => {
                          const next = prev.filter((_, idx) => idx !== i);
                          // revoke url for removed
                          URL.revokeObjectURL(r.url);
                          return next;
                        });
                      }}
                      className="absolute top-1 right-1 rounded bg-foreground/10 px-2 py-1 text-xs"
                      aria-label={`Remove image ${i + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        {/* Right area */}
        <section className="flex-1 p-6 flex flex-col">
          <div className="flex-1 border border-foreground/10 rounded bg-foreground/5 flex items-center justify-center">
            {generatedImageUrl ? (
              <img src={generatedImageUrl} alt="generated" className="w-full h-full object-contain" />
            ) : (
              <div className="text-foreground/50">Image preview area</div>
            )}
          </div>

          <div className="mt-4">
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="prompt"
                className="w-full min-h-[96px] rounded border border-foreground/10 bg-background p-4 pr-28 text-sm resize-none"
              />
              <button
                type="button"
                onClick={() => {
                  (async () => {
                      // clear preview immediately while generating
                      setGeneratedImageUrl(null);
                      setIsGeneratingImage(true);
                    try {
                      const attachedImages = await Promise.all(
                        refs.map(async (r) => ({
                          fileName: r.file.name,
                          base64: await fileToDataUrl(r.file),
                        }))
                      );

                      const outputFileName = `panel-image-${Date.now()}`;
                      const body = {
                        prompt,
                        model,
                        outputFileName,
                        aspectRatio: aspect,
                        attachedImages,
                        projectId: "project-X",
                      };

                      const res = await fetch("/api/generate-panel-image", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                      });

                      const data = await res.json();
                      if (!res.ok) {
                        throw new Error(typeof data?.error === "string" ? data.error : "Image generation failed");
                      }

                      if (typeof data?.content !== "string") {
                        throw new Error("Invalid response from server");
                      }

                      setGeneratedImageUrl(data.content);
                    } catch (err) {
                      alert(err instanceof Error ? err.message : "Failed to generate image");
                    } finally {
                      setIsGeneratingImage(false);
                    }
                  })();
                }}
                className="absolute right-3 bottom-3 rounded bg-accent px-3 py-1.5 text-sm font-semibold text-background"
              >
                {isGeneratingImage ? "Generating…" : "Generate"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}


