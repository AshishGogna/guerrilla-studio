"use client";

import { useEffect, useRef, useState } from "react";

const MIN_TEXTAREA_HEIGHT = 44;

function resizeTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.max(MIN_TEXTAREA_HEIGHT, el.scrollHeight)}px`;
}

type PanelMode = "image" | "video";

interface RefImage {
  file: File;
  url: string;
}

interface PanelItem {
  imageUrl: string | null;
  prompt: string;
  mode: PanelMode;
  referenceImages: RefImage[];
}

const defaultPanel: PanelItem = {
  imageUrl: null,
  prompt: "",
  mode: "image",
  referenceImages: [],
};

export default function Storyboarding() {
  const [panels, setPanels] = useState<PanelItem[]>([{ ...defaultPanel }]);
  const textareaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

  useEffect(() => {
    textareaRefs.current.forEach(resizeTextarea);
  }, [panels]);

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

  function removePanel(index: number) {
    setPanels((prev) => {
      const panel = prev[index];
      panel.referenceImages.forEach((r) => URL.revokeObjectURL(r.url));
      return prev.filter((_, i) => i !== index);
    });
  }

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachPanelIndex, setAttachPanelIndex] = useState<number | null>(null);

  function handleRefImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length || attachPanelIndex == null) return;
    const newRefs: RefImage[] = Array.from(files).map((f) => ({
      file: f,
      url: URL.createObjectURL(f),
    }));
    const panelIndex = attachPanelIndex;
    setAttachPanelIndex(null);
    setPanels((prev) => {
      const next = [...prev];
      next[panelIndex] = {
        ...next[panelIndex],
        referenceImages: [...next[panelIndex].referenceImages, ...newRefs],
      };
      return next;
    });
    e.target.value = "";
  }

  function removeRefImage(panelIndex: number, refIndex: number) {
    setPanels((prev) => {
      const next = [...prev];
      const refs = next[panelIndex].referenceImages;
      URL.revokeObjectURL(refs[refIndex].url);
      next[panelIndex] = {
        ...next[panelIndex],
        referenceImages: refs.filter((_, i) => i !== refIndex),
      };
      return next;
    });
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background p-6 text-foreground">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleRefImages}
      />
      <div className="grid grid-cols-3 gap-6">
        {panels.map((panel, index) => (
          <div
            key={index}
            className="relative flex flex-col gap-3 rounded-lg"
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

            {/* Preview: image area with floating prompt */}
            <div className="relative flex min-h-[300px] flex-col rounded-lg border border-foreground/10 bg-foreground/5">
              <div className="absolute left-2 top-2 z-10 flex gap-1">
                <button
                  type="button"
                  onClick={() => updatePanel(index, { mode: "image" })}
                  className={`rounded p-1.5 transition ${
                    panel.mode === "image"
                      ? "bg-accent text-background"
                      : "bg-foreground/10 text-foreground/60 hover:bg-foreground/20 hover:text-foreground/80"
                  }`}
                  title="Image mode"
                  aria-label="Image mode"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => updatePanel(index, { mode: "video" })}
                  className={`rounded p-1.5 transition ${
                    panel.mode === "video"
                      ? "bg-accent text-background"
                      : "bg-foreground/10 text-foreground/60 hover:bg-foreground/20 hover:text-foreground/80"
                  }`}
                  title="Video mode"
                  aria-label="Video mode"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect width="15" height="14" x="1" y="5" rx="2" ry="2" />
                  </svg>
                </button>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center p-2">
                {panel.imageUrl ? (
                  <img
                    src={panel.imageUrl}
                    alt={`Panel ${index + 1}`}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-sm text-foreground/40"></span>
                )}
              </div>

              {/* Floating prompt: always visible, no background or border */}
              <div className="absolute bottom-0 left-0 right-0 z-10 flex items-end gap-1 p-2">
                <button
                  type="button"
                  onClick={() => {
                    setAttachPanelIndex(index);
                    fileInputRef.current?.click();
                  }}
                  className="shrink-0 rounded p-1.5 text-foreground/60 transition hover:bg-foreground/10 hover:text-foreground"
                  title="Attach reference images"
                  aria-label="Attach reference images"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                  </svg>
                </button>
                {panel.referenceImages.length > 0 && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    {panel.referenceImages.map((ref, refIndex) => (
                      <div key={refIndex} className="relative">
                        <img src={ref.url} alt="" className="h-8 w-8 rounded object-cover" />
                        <button
                          type="button"
                          onClick={() => removeRefImage(index, refIndex)}
                          className="absolute -right-1 -top-1 rounded-full bg-foreground/80 p-0.5 text-background hover:bg-foreground"
                          title="Remove"
                          aria-label="Remove reference image"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6 6 18" />
                            <path d="m6 6 12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  ref={(el) => {
                    textareaRefs.current[index] = el;
                  }}
                  value={panel.prompt}
                  onChange={(e) => updatePanel(index, { prompt: e.target.value })}
                  placeholder={panel.mode === "image" ? "Image generation prompt" : "Video generation prompt"}
                  className="min-h-[44px] min-w-0 flex-1 resize-none border-0 px-0 py-1 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-0 text-center overflow-hidden bg-transparent"
                  rows={1}
                />
                <button
                  type="button"
                  disabled={!panel.prompt.trim()}
                  onClick={() => {
                    if (panel.mode === "image") {
                      // TODO: wire to image generation API
                    } else {
                      // TODO: wire to video generation API
                    }
                  }}
                  className="shrink-0 rounded p-1.5 text-foreground/70 transition hover:text-foreground disabled:opacity-40 mb-3"
                  title={panel.mode === "image" ? "Generate Image" : "Generate Video"}
                  aria-label={panel.mode === "image" ? "Generate Image" : "Generate Video"}
                >
                  Gen
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6">
        <button
          type="button"
          onClick={addPanel}
          className="rounded border border-dashed border-foreground/20 px-4 py-2 text-sm text-foreground/60 hover:border-foreground/40 hover:text-foreground/80"
        >
          + Add panel
        </button>
      </div>
    </div>
  );
}
