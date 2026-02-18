"use client";

import { generatePanelPrompts, generateScript, generatePanelImage } from "@/lib/ai";
import { loadPanelData, savePanelData } from "@/lib/panels-storage";
import { useEffect, useState } from "react";

const PROJECT_ID = "X";

export default function PanelsPage() {
  const [scriptOpen, setScriptOpen] = useState(true);
  const [secondPanelOpen, setSecondPanelOpen] = useState(true);
  const [script, setScript] = useState("");
  const [worldAndCharacters, setWorldAndCharacters] = useState("");
  const [systemPromptWorldAndCharacters, setSystemPromptWorldAndCharacters] = useState("");
  const [systemPromptScript, setSystemPromptScript] = useState("");
  const [systemPromptEditorPanel, setSystemPromptEditorPanel] = useState<
    null | "world-and-characters" | "script"
  >(null);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isGeneratingPanelPrompts, setIsGeneratingPanelPrompts] = useState(false);
  const [panelPrompts, setPanelPrompts] = useState<string[]>([]);
  const [panelImages, setPanelImages] = useState<(string)[]>([]);
  const [generatingPanelIndex, setGeneratingPanelIndex] = useState<number | null>(null);

  useEffect(() => {
    const data = loadPanelData(PROJECT_ID);
    setScript(data.script);
    setWorldAndCharacters(data.worldAndCharacters);
    setSystemPromptWorldAndCharacters(data.systemPromptWorldAndCharacters);
    setSystemPromptScript(data.systemPromptScript);
    setPanelPrompts(data.panelPrompts);
    setPanelImages(data.panelImages);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      savePanelData(PROJECT_ID, {
        script,
        worldAndCharacters,
        systemPromptWorldAndCharacters,
        systemPromptScript,
        panelPrompts,
        panelImages
      });
      console.log("Saved Project!");
    }, 400);
    return () => clearTimeout(t);
  }, [
    script,
    worldAndCharacters,
    systemPromptWorldAndCharacters,
    systemPromptScript,
    panelPrompts,
    panelImages
  ]);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* World and Characters toggle strip */}
      <div className="flex w-8 shrink-0 flex-col items-center gap-1 border-r border-foreground/10 bg-background py-2">
        <button
          type="button"
          onClick={() => setSecondPanelOpen((open) => !open)}
          className="flex h-12 w-8 items-center justify-center text-foreground/60 transition hover:text-foreground"
          title={secondPanelOpen ? "Collapse World and Characters" : "Expand World and Characters"}
          aria-label={secondPanelOpen ? "Collapse World and Characters" : "Expand World and Characters"}
        >
          {secondPanelOpen ? "◀" : "▶"}
        </button>
        <button
          type="button"
          onClick={() => setSystemPromptEditorPanel("world-and-characters")}
          className="flex w-8 items-center justify-center text-foreground/50 transition hover:text-foreground/80"
          title="System Prompt"
          aria-label="System Prompt"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M16 13H8" />
            <path d="M16 17H8" />
            <path d="M10 9H8" />
          </svg>
        </button>
      </div>

      {/* World and Characters panel: 20% width or 0, full height */}
      <div
        className="flex shrink-0 flex-col overflow-hidden border-r border-foreground/10 transition-[width] duration-200 ease-out"
        style={{ width: secondPanelOpen ? "20%" : 0 }}
      >
        <label
          htmlFor="world-and-characters"
          className="shrink-0 border-b border-foreground/10 px-4 py-2 font-mono text-sm uppercase tracking-wider text-foreground/70"
        >
          World and Characters
        </label>
        <textarea
          id="world-and-characters"
          name="world-and-characters"
          value={worldAndCharacters}
          onChange={(e) => setWorldAndCharacters(e.target.value)}
          placeholder="…"
          className="min-h-0 min-w-[200px] flex-1 resize-none border-0 bg-transparent px-4 py-3 font-mono text-[12pt] leading-relaxed text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-0"
          style={{ fontFamily: "Cursor, var(--font-mono), ui-monospace, monospace" }}
        />
        <div className="shrink-0 border-t border-foreground/10 p-3">
          <button
            type="button"
            disabled={isGeneratingScript}
            onClick={async () => {
              setIsGeneratingScript(true);
              try {
                const result = await generateScript(
                  worldAndCharacters,
                  systemPromptWorldAndCharacters
                );
                setScript(result);
              } catch (err) {
                alert(err instanceof Error ? err.message : "Failed to generate script");
              } finally {
                setIsGeneratingScript(false);
              }
            }}
            className="flex w-full items-center justify-center gap-2 rounded bg-accent px-3 py-2 text-sm font-semibold text-background transition hover:bg-accent-muted disabled:opacity-70"
          >
            {isGeneratingScript ? (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                Generating…
              </>
            ) : (
              "Generate a Script"
            )}
          </button>
        </div>
      </div>

      {/* Script toggle strip */}
      <div className="flex w-8 shrink-0 flex-col items-center gap-1 border-r border-foreground/10 bg-background py-2">
        <button
          type="button"
          onClick={() => setScriptOpen((open) => !open)}
          className="flex h-12 w-8 items-center justify-center text-foreground/60 transition hover:text-foreground"
          title={scriptOpen ? "Collapse Script" : "Expand Script"}
          aria-label={scriptOpen ? "Collapse Script" : "Expand Script"}
        >
          {scriptOpen ? "◀" : "▶"}
        </button>
        <button
          type="button"
          onClick={() => setSystemPromptEditorPanel("script")}
          className="flex w-8 items-center justify-center text-foreground/50 transition hover:text-foreground/80"
          title="System Prompt"
          aria-label="System Prompt"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M16 13H8" />
            <path d="M16 17H8" />
            <path d="M10 9H8" />
          </svg>
        </button>
      </div>

      {/* Script panel: 20% width or 0, full height */}
      <div
        className="flex shrink-0 flex-col overflow-hidden border-r border-foreground/10 transition-[width] duration-200 ease-out"
        style={{ width: scriptOpen ? "20%" : 0 }}
      >
        <label
          htmlFor="script"
          className="shrink-0 border-b border-foreground/10 px-4 py-2 font-mono text-sm uppercase tracking-wider text-foreground/70"
        >
          Script
        </label>
        <textarea
          id="script"
          name="script"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder="Paste or type script…"
          className="min-h-0 min-w-[200px] flex-1 resize-none border-0 bg-transparent px-4 py-3 font-mono text-[12pt] leading-relaxed text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-0"
          style={{ fontFamily: "Cursor, var(--font-mono), ui-monospace, monospace" }}
        />
        <div className="shrink-0 border-t border-foreground/10 p-3">
          <button
            type="button"
            disabled={isGeneratingPanelPrompts}
            onClick={async () => {
              setIsGeneratingPanelPrompts(true);
              try {
                const prompts = await generatePanelPrompts(script, systemPromptScript);
                setPanelPrompts(prompts);
                setPanelImages(new Array(prompts.length).fill(null));
              } catch (err) {
                alert(err instanceof Error ? err.message : "Failed to generate panel prompts");
              } finally {
                setIsGeneratingPanelPrompts(false);
              }
            }}
            className="flex w-full items-center justify-center gap-2 rounded bg-accent px-3 py-2 text-sm font-semibold text-background transition hover:bg-accent-muted disabled:opacity-70"
          >
            {isGeneratingPanelPrompts ? (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                Generating…
              </>
            ) : (
              "Generate Panel Prompts"
            )}
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="min-w-0 flex-1 overflow-auto flex flex-col">
        <div className="flex-1" />
        {panelPrompts.length > 0 && (
          <div className="p-4">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {panelPrompts.map((prompt, index) => (
                <div key={index} className="flex flex-col">
                  {panelImages[index] && (
                    <div className="shrink-0 mb-2">
                      <img 
                        src={panelImages[index]} 
                        alt={`Panel ${index + 1}`}
                        className="w-[300px] h-32 object-contain"
                      />
                    </div>
                  )}
                  <div
                    className="flex-shrink-0 w-[300px] border border-foreground/20 bg-background/50 overflow-hidden"
                  >
                    <div className="shrink-0 border-b border-foreground/10 p-2">
                      <button
                        type="button"
                        disabled={generatingPanelIndex === index}
                        onClick={async () => {
                          setGeneratingPanelIndex(index);
                          try {
                            const image = await generatePanelImage(prompt, PROJECT_ID, index);
                            const newImages = [...panelImages];
                            newImages[index] = image;
                            setPanelImages(newImages);
                          } catch (err) {
                            alert(err instanceof Error ? err.message : "Failed to generate panel image");
                          } finally {
                            setGeneratingPanelIndex(null);
                          }
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded bg-accent px-3 py-2 text-sm font-semibold text-background transition hover:bg-accent-muted disabled:opacity-70"
                      >
                        {generatingPanelIndex === index ? (
                          <>
                            <span className="size-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                            Generating…
                          </>
                        ) : (
                          "Generate Panel"
                        )}
                      </button>
                    </div>
                    <div className="p-2 h-[176px]">
                      <textarea
                        value={prompt}
                        onChange={(e) => {
                          const newPrompts = [...panelPrompts];
                          newPrompts[index] = e.target.value;
                          setPanelPrompts(newPrompts);
                        }}
                        className="w-full h-full resize-none border-0 bg-transparent font-mono text-[12px] leading-tight text-foreground/80 placeholder:text-foreground/40 focus:outline-none focus:ring-0"
                        style={{ fontFamily: "Cursor, var(--font-mono), ui-monospace, monospace" }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* System Prompt modal */}
      {systemPromptEditorPanel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSystemPromptEditorPanel(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-foreground/20 bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b border-foreground/10 px-4 py-2 font-mono text-sm uppercase tracking-wider text-foreground/70">
              System Prompt —{" "}
              {systemPromptEditorPanel === "world-and-characters"
                ? "For generating a script"
                : "For generating story panels"}
            </div>
            <textarea
              value={
                systemPromptEditorPanel === "world-and-characters"
                  ? systemPromptWorldAndCharacters
                  : systemPromptScript
              }
              onChange={(e) =>
                systemPromptEditorPanel === "world-and-characters"
                  ? setSystemPromptWorldAndCharacters(e.target.value)
                  : setSystemPromptScript(e.target.value)
              }
              placeholder="Enter system prompt for this panel…"
              className="min-h-[200px] flex-1 resize-none border-0 bg-transparent p-4 font-mono text-sm leading-relaxed text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-0"
              style={{ fontFamily: "Cursor, var(--font-mono), ui-monospace, monospace" }}
            />
            <div className="shrink-0 border-t border-foreground/10 px-4 py-2">
              <button
                type="button"
                onClick={() => setSystemPromptEditorPanel(null)}
                className="rounded bg-foreground/10 px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-foreground/20"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
