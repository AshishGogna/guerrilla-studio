"use client";

import { generatePanelPrompts, generateScript, generateImage } from "@/lib/ai";
import { loadPanelData, savePanelData } from "@/lib/panels-storage";
import { useEffect, useState } from "react";
import TopBar from "@/components/TopBar";

const PROJECT_ID = "X";

export default function PanelsPage() {
  const [scriptOpen, setScriptOpen] = useState(true);
  const [secondPanelOpen, setSecondPanelOpen] = useState(true);
  const [charactersOpen, setCharactersOpen] = useState(false);
  const [worldView, setWorldView] = useState<"world" | "characters">("world");
  const [script, setScript] = useState("");
  const [worldAndCharacters, setWorldAndCharacters] = useState("");
  const [systemPromptWorldAndCharacters, setSystemPromptWorldAndCharacters] = useState("");
  const [systemPromptScript, setSystemPromptScript] = useState("");
  const [systemPromptEditorPanel, setSystemPromptEditorPanel] = useState<
    null | "world-and-characters" | "script"
  >(null);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isGeneratingPanelPrompts, setIsGeneratingPanelPrompts] = useState(false);
  const [panelPrompts, setPanelPrompts] = useState<{script_part: string; panel_prompt: string}[]>([]);
  const [panelImages, setPanelImages] = useState<(string)[]>([]);
  const [videoPrompts, setVideoPrompts] = useState<{script_part: string; panel_prompt: string; panel_description: string; video_prompt: string}[]>([]);
  const [generatingPanelIndex, setGeneratingPanelIndex] = useState<number | null>(null);
  const [characters, setCharacters] = useState<{name: string; imagePrompt: string; image?: string}[]>([{name: "", imagePrompt: ""}]);
  const [generatingCharacterIndex, setGeneratingCharacterIndex] = useState<number | null>(null);
  // Convert File objects to base64 strings for storage
  const convertFilesToBase64 = (files: File[]): Promise<string[]> => {
    return Promise.all(files.map(file => 
      new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      })
    ));
  };

  // Convert base64 strings back to File objects for UI
  const convertBase64ToFiles = async (base64Strings: string[], originalFiles?: File[]): Promise<File[]> => {
    return Promise.all(base64Strings.map((base64, index) => 
      new Promise((resolve) => {
        if (originalFiles?.[index]) {
          resolve(originalFiles[index]);
          return;
        }
        fetch(base64)
          .then(res => res.blob())
          .then(blob => {
            const fileName = `attached-image-${index}.png`;
            resolve(new File([blob], fileName, 'image/png'));
          });
      })
    ));
  };

  const [attachedImages, setAttachedImages] = useState<{[key: number]: {fileName: string; base64: string}[]}>({});

  useEffect(() => {
    const data = loadPanelData(PROJECT_ID);
    setScript(data.script);
    setWorldAndCharacters(data.worldAndCharacters);
    setSystemPromptWorldAndCharacters(data.systemPromptWorldAndCharacters);
    setSystemPromptScript(data.systemPromptScript);
    setPanelPrompts(data.panelPrompts);
    setPanelImages(data.panelImages);
    setCharacters(data.characters || [{name: "", imagePrompt: ""}]);
    setAttachedImages(data.attachedImages || {});
    setVideoPrompts(data.videoPrompts || []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      savePanelData(PROJECT_ID, {
        script,
        worldAndCharacters,
        systemPromptWorldAndCharacters,
        systemPromptScript,
        panelPrompts,
        panelImages,
        characters,
        attachedImages: attachedImages,
        videoPrompts: videoPrompts
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
    panelImages,
    characters,
    attachedImages,
    videoPrompts
  ]);

  return (
    <div className="flex min-h-screen bg-background text-foreground flex-col">
      <TopBar title="Panels" />
      <div className="flex flex-1 overflow-hidden">
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
          onClick={() => setWorldView("world")}
          className={`flex w-8 items-center justify-center transition ${
            worldView === "world" ? "text-foreground" : "text-foreground/50 hover:text-foreground/80"
          }`}
          title="World"
          aria-label="World"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setWorldView("characters")}
          className={`flex w-8 items-center justify-center transition ${
            worldView === "characters" ? "text-foreground" : "text-foreground/50 hover:text-foreground/80"
          }`}
          title="Characters"
          aria-label="Characters"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
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
        {worldView === "world" ? (
          <>
            <label
              htmlFor="world-and-characters"
              className="shrink-0 border-b border-foreground/10 px-4 py-2 font-mono text-sm uppercase tracking-wider text-foreground/70"
            >
              World
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

          </>
        ) : (
          <>
            <label
              htmlFor="characters"
              className="shrink-0 border-b border-foreground/10 px-4 py-2 font-mono text-sm uppercase tracking-wider text-foreground/70"
            >
              Characters
            </label>
            <div className="flex-1 overflow-y-auto p-3">
              {characters.map((character, index) => (
                <div key={index} className="mb-3 border border-foreground/10 rounded bg-background/50 p-2">
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={character.name}
                      onChange={(e) => {
                        const newCharacters = [...characters];
                        newCharacters[index] = {...newCharacters[index], name: e.target.value};
                        setCharacters(newCharacters);
                      }}
                      placeholder="Character name..."
                      className="w-full p-y-6 border-b border-foreground/10 bg-transparent font-mono text-[12px] leading-relaxed text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-0 mb-2"
                      style={{ fontFamily: "Cursor, var(--font-mono), ui-monospace, monospace" }}
                    />

                    <button
                      type="button"
                      onClick={() => {
                        if (characters.length > 1) {
                          const newCharacters = characters.filter((_, i) => i !== index);
                          setCharacters(newCharacters);
                        }
                      }}
                      className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded border border-foreground/20 text-foreground/60 hover:text-foreground hover:border-foreground/40 transition"
                      title="Delete character"
                    >
                      ×
                    </button>
                  </div>
                  {character.image && (
                    <div className="mb-2">
                      <img 
                        src={character.image} 
                        alt={character.name || `Character ${index + 1}`}
                        className="w-full h-auto rounded border border-foreground/10"
                      />
                    </div>
                  )}
                  <div className="mb-2">
                    <textarea
                      value={character.imagePrompt}
                      onChange={(e) => {
                        const newCharacters = [...characters];
                        newCharacters[index] = {...newCharacters[index], imagePrompt: e.target.value};
                        setCharacters(newCharacters);
                      }}
                      placeholder="Character image prompt..."
                      className="w-full min-h-[60px] resize-none border-0 bg-transparent font-mono text-[12px] leading-relaxed text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-0"
                      style={{ fontFamily: "Cursor, var(--font-mono), ui-monospace, monospace" }}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={generatingCharacterIndex === index}
                    onClick={async () => {
                      setGeneratingCharacterIndex(index);
                      try {
                        const image = await generateImage(character.imagePrompt, character.name || `character-${index}`, "1:1");
                        const newCharacters = [...characters];
                        newCharacters[index] = {...newCharacters[index], image};
                        setCharacters(newCharacters);
                      } catch (err) {
                        alert(err instanceof Error ? err.message : "Failed to generate character image");
                      } finally {
                        setGeneratingCharacterIndex(null);
                      }
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded bg-accent px-2 py-1 text-xs font-semibold text-background transition hover:bg-accent-muted disabled:opacity-70"
                  >
                    {generatingCharacterIndex === index ? (
                      <>
                        <span className="size-3 animate-spin rounded-full border-2 border-background border-t-transparent" />
                        Generating…
                      </>
                    ) : (
                      "GENERATE CHARACTER"
                    )}
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setCharacters([...characters, {name: "", imagePrompt: ""}])}
                className="flex w-full items-center justify-center gap-2 rounded border border-foreground/20 px-2 py-1 text-xs font-medium text-foreground/60 hover:text-foreground hover:border-foreground/40 transition"
              >
                + Add Character
              </button>
            </div>
          </>
        )}
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
                setAttachedImages({});
                setVideoPrompts(prompts.map((prompt) => ({ script_part: prompt.script_part, panel_prompt: prompt.panel_prompt, panel_description: "", video_prompt: "" })));
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
          <div className="p-10">
            <div className="flex gap-10 overflow-x-auto pb-2">
              {panelPrompts.map((panelPrompt, index) => (
                <div key={index} className="flex flex-col gap-2 p-4">
                  {videoPrompts[index] && (
                    <div className="border border-foreground/20">
                      <textarea
                        value={videoPrompts[index].video_prompt}
                        onChange={(e) => {
                          const newVideoPrompts = [...videoPrompts];
                          newVideoPrompts[index] = {...newVideoPrompts[index], video_prompt: e.target.value};
                          setVideoPrompts(newVideoPrompts);
                        }}
                        placeholder="Describe the visual elements, camera angle, lighting, mood..."
                        className="w-full h-50 resize-none border-0 bg-transparent px-2 py-1 text-xs text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-0"
                      />
                    </div> 
                  )}                       
                  {panelImages[index] && (
                    <div className="relative">
                      <img
                        src={panelImages[index]}
                        alt={`Panel ${index + 1}`}
                        className="w-full h-48 object-cover rounded border border-foreground/10"
                      />
                    </div>
                  )}
                  <div className="flex gap-2">
                    {panelImages[index] ? (
                      <div className="flex-1"></div>
                    ) : (
                      <div className="flex-1"></div>
                    )}
                    <div
                      className="flex-col w-[300px] p-4 border border-foreground/20 bg-background/50 overflow-hidden"
                    >
                      <div className="shrink-0 border-b border-foreground/10 p-2">
                        <button
                          type="button"
                          disabled={generatingPanelIndex === index}
                          onClick={async () => {
                            setGeneratingPanelIndex(index);
                            try {
                              const image = await generateImage(panelPrompt.panel_prompt, `P-${index}`, "16:9", attachedImages[index] || []);
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
                      {/* Image attachments */}
                      <div className="px-2 py-2">
                        <div className="flex gap-2 overflow-x-auto">
                          {attachedImages[index]?.map((attachment, fileIndex) => (
                            <div key={fileIndex} className="flex items-center gap-2 p-2 border border-foreground/10 rounded bg-background/50">
                              <img 
                                src={attachment.base64} 
                                alt={attachment.fileName} 
                                className="w-8 h-8 object-cover rounded"
                              />
                              <span className="text-xs text-foreground/70 truncate max-w-[100px]">
                                {attachment.fileName}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  const newAttachedImages = {...attachedImages};
                                  newAttachedImages[index] = newAttachedImages[index].filter((_, i) => i !== fileIndex);
                                  setAttachedImages(newAttachedImages);
                                }}
                                className="text-foreground/60 hover:text-foreground transition"
                                title="Remove image"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-2 px-3 py-2 border border-foreground/20 rounded text-xs text-foreground/60 hover:text-foreground hover:border-foreground/40 transition cursor-pointer">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="17 8 12 3 7 8" />
                                <line x1="12" y1="3" x2="12" y2="15" />
                              </svg>
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={async (e) => {
                                  const files = Array.from(e.target.files || []);
                                  if (files.length > 0) {
                                    const currentImages = attachedImages[index] || [];
                                    const newAttachments = [];
                                    
                                    for (const file of files) {
                                      const base64String = await new Promise<string>((resolve) => {
                                        const reader = new FileReader();
                                        reader.onload = () => resolve(reader.result as string);
                                        reader.readAsDataURL(file);
                                      });
                                      newAttachments.push({fileName: file.name, base64: base64String});
                                    }
                                    
                                    setAttachedImages({...attachedImages, [index]: [...currentImages, ...newAttachments]});
                                  }
                                }}
                                className="hidden"
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                      <textarea
                        value={panelPrompt.panel_prompt}
                        onChange={(e) => {
                          const newPanelPrompts = [...panelPrompts];
                          newPanelPrompts[index] = {...newPanelPrompts[index], panel_prompt: e.target.value};
                          setPanelPrompts(newPanelPrompts);
                        }}
                        placeholder="Describe the visual elements, camera angle, lighting, mood..."
                        className="w-full h-50 resize-none border-0 bg-transparent px-2 py-1 text-xs text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-0"
                      />
                    </div>
                  </div>
                      <div>
                        {panelPrompt.script_part}
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
    </div>
  );
}
