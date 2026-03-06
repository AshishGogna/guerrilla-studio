"use client";

import { useState } from "react";

const MODELS = ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"] as const;
const ASPECT_RATIOS = ["16:9", "9:16"] as const;
const RESOLUTIONS = ["1k", "2k"] as const;

interface PanelItem {
  imageUrl: string | null;
  prompt: string;
  videoPrompt: string;
  model: (typeof MODELS)[number];
  aspectRatio: (typeof ASPECT_RATIOS)[number];
  referenceImages: { file: File; url: string }[];
}

const defaultPanel: PanelItem = {
  imageUrl: null,
  prompt: "",
  videoPrompt: "",
  model: "g2",
  aspectRatio: "16:9",
  referenceImages: [],
};

export default function Storyboarding() {
  const [panels, setPanels] = useState<PanelItem[]>([{ ...defaultPanel }]);

  function updatePanel(index: number, updates: Partial<PanelItem>) {
    setPanels((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }

  function addPanel() {
    setPanels((prev) => [...prev, { ...defaultPanel }]);
  }

  function handleRefImages(index: number, files: FileList | null) {
    if (!files?.length) return;
    const newRefs = Array.from(files).map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setPanels((prev) => {
      const next = [...prev];
      next[index].referenceImages.forEach((r) => URL.revokeObjectURL(r.url));
      next[index] = { ...next[index], referenceImages: [...next[index].referenceImages, ...newRefs] };
      return next;
    });
  }

  function removeRefImage(panelIndex: number, refIndex: number) {
    setPanels((prev) => {
      const next = [...prev];
      const ref = next[panelIndex].referenceImages[refIndex];
      URL.revokeObjectURL(ref.url);
      next[panelIndex] = {
        ...next[panelIndex],
        referenceImages: next[panelIndex].referenceImages.filter((_, i) => i !== refIndex),
      };
      return next;
    });
  }


  function removePanel(index: number) {
    setPanels((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="flex h-full flex-1 overflow-hidden bg-background text-foreground">
      <div className="flex h-full flex-row overflow-x-auto">
        {panels.map((panel, index) => (
          <div
            key={index}
            className="relative flex h-full w-screen min-w-[100vw] shrink-0 flex-col gap-4 border-r border-foreground/10 bg-background/50 p-6"
          >
            <button
              type="button"
              onClick={() => removePanel(index)}
              className="absolute right-2 top-2 rounded p-1.5 text-foreground/50 hover:bg-foreground/10 hover:text-foreground"
              title="Remove panel"
              aria-label="Remove panel"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            </button>
            <div className="flex min-h-100 flex-1 items-center justify-center rounded border border-foreground/10 bg-foreground/5">
              {panel.imageUrl ? (
                <img
                  src={panel.imageUrl}
                  alt={`Panel ${index + 1}`}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-sm text-foreground/40">Preview</span>
              )}
            </div>
            <div className="flex gap-3">
              <textarea
                value={panel.prompt}
                onChange={(e) => updatePanel(index, { prompt: e.target.value })}
                placeholder="Image gen prompt"
                className="min-h-[80px] min-w-0 flex-1 resize-none rounded border border-foreground/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-1 focus:ring-accent/50"
                rows={3}
              />
              <div className="flex w-40 shrink-0 flex-col gap-2">
                <div>
                  <label className="mb-0.5 block text-xs text-foreground/50">Model</label>
                  <select
                    value={panel.model}
                    onChange={(e) => updatePanel(index, { model: e.target.value as PanelItem["model"] })}
                    className="w-full rounded border border-foreground/10 bg-transparent px-2 py-1.5 text-sm"
                  >
                    {MODELS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-foreground/50">Aspect ratio</label>
                  <select
                    value={panel.aspectRatio}
                    onChange={(e) => updatePanel(index, { aspectRatio: e.target.value as PanelItem["aspectRatio"] })}
                    className="w-full rounded border border-foreground/10 bg-transparent px-2 py-1.5 text-sm"
                  >
                    {ASPECT_RATIOS.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    id={`ref-${index}`}
                    className="hidden"
                    onChange={(e) => {
                      handleRefImages(index, e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => document.getElementById(`ref-${index}`)?.click()}
                    className="w-full rounded border border-foreground/20 px-2 py-1.5 text-xs text-foreground/70 hover:bg-foreground/5"
                  >
                    Attach reference images
                  </button>
                  {panel.referenceImages.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {panel.referenceImages.map((ref, refIdx) => (
                        <div key={refIdx} className="relative">
                          <img src={ref.url} alt="" className="h-10 w-10 rounded object-cover" />
                          <button
                            type="button"
                            onClick={() => removeRefImage(index, refIdx)}
                            className="absolute -right-1 -top-1 rounded-full bg-foreground/80 px-1 text-[10px] text-background hover:bg-foreground"
                            aria-label="Remove"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <textarea
              value={panel.videoPrompt}
              onChange={(e) => updatePanel(index, { videoPrompt: e.target.value })}
              placeholder="Video generation prompt"
              className="min-h-[80px] w-full resize-none rounded border border-foreground/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-1 focus:ring-accent/50"
              rows={3}
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!panel.prompt.trim()}
                onClick={() => {
                  // TODO: wire to image generation API
                }}
                className="flex-1 rounded bg-accent px-4 py-2 text-sm font-semibold text-background transition hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Generate image
              </button>
              <button
                type="button"
                disabled={!panel.imageUrl}
                onClick={() => {
                  // TODO: wire to video generation API
                }}
                className="flex-1 rounded bg-accent px-4 py-2 text-sm font-semibold text-background transition hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Generate video
              </button>
            </div>
          </div>
        ))}
        <div className="flex h-full min-w-[200px] shrink-0 items-center justify-center border-r border-foreground/10 pr-4">
          <button
            type="button"
            onClick={addPanel}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-foreground/20 bg-background/50 px-8 py-6 text-foreground/60 transition hover:border-accent/50 hover:text-accent/80"
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            <span className="text-sm font-medium">Add panel</span>
          </button>
        </div>
      </div>
    </div>
  );
}
