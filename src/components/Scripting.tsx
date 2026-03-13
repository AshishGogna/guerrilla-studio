"use client";

import { useEffect, useRef, useState } from "react";
import { addData, getData } from "@/lib/data";
import { generateText } from "@/lib/ai";
import {
  loadScriptingState,
  saveScriptingState,
  type ScriptingTemplate,
} from "@/lib/panels-storage";

const MODEL_OPTIONS = [
  "gpt-5.4",
  "gpt-5-mini-2025-08-07",
] as const;

/** Replaces backtick-enclosed placeholders like `data.speech` with values from the data lib. */
function resolveDataPlaceholders(text: string): string {
  return text.replace(/`([^`]+)`/g, (_, inner) => {
    const trimmed = inner.trim();
    if (trimmed.startsWith("data.")) {
      const key = trimmed.slice(5).trim();
      const value = getData(key);
      if (value === undefined) return "";
      return typeof value === "string" ? value : JSON.stringify(value);
    }
    // return "`" + inner + "`"; // dont remove
    return inner;
  });
}

function SendIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function FullScreenIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
      <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function HideIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

function UnhideIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function LoaderIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="animate-spin"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

type ScriptingProps = { projectId: string };

export default function Scripting({ projectId }: ScriptingProps) {
  const [templates, setTemplates] = useState<ScriptingTemplate[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalValue, setModalValue] = useState("");
  const [modalSource, setModalSource] = useState<{
    templateIndex: number;
    stepIndex: number;
  } | null>(null);
  const [hiddenTemplateIds, setHiddenTemplateIds] = useState<Set<string>>(
    new Set()
  );
  const [selectedModel, setSelectedModel] = useState<string>(MODEL_OPTIONS[0]);
  const [generatingStep, setGeneratingStep] = useState<{
    templateIndex: number;
    stepIndex: number;
  } | null>(null);
  const scriptingLoadedRef = useRef(false);

  const handleGenerate = async (templateIndex: number, stepIndex: number) => {
    const stepValue = templates[templateIndex]?.steps[stepIndex] ?? "";
    const prompt = resolveDataPlaceholders(stepValue);
    setGeneratingStep({ templateIndex, stepIndex });
    try {
      const content = await generateText(prompt, "", selectedModel);
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          addData(key, value);
        }
      }
      console.log("Generate response:", content);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generate failed";
      alert(message);
    } finally {
      setGeneratingStep(null);
    }
  };

  useEffect(() => {
    const state = loadScriptingState(projectId);
    setTemplates(state.templates);
    setHiddenTemplateIds(new Set(state.hiddenTemplateIds));
    queueMicrotask(() => {
      scriptingLoadedRef.current = true;
    });
  }, [projectId]);

  useEffect(() => {
    if (!scriptingLoadedRef.current) return;
    saveScriptingState(projectId, {
      templates,
      hiddenTemplateIds: Array.from(hiddenTemplateIds),
    });
  }, [projectId, templates, hiddenTemplateIds]);

  const toggleTemplateHidden = (templateId: string) => {
    setHiddenTemplateIds((prev) => {
      const next = new Set(prev);
      if (next.has(templateId)) next.delete(templateId);
      else next.add(templateId);
      return next;
    });
  };

  const addTemplate = () => {
    setTemplates((prev) => [
      ...prev,
      { id: `t-${Date.now()}`, name: "New Template", steps: [""] },
    ]);
  };

  const removeTemplate = (templateIndex: number) => {
    const template = templates[templateIndex];
    if (!template) return;
    setHiddenTemplateIds((prev) => {
      const next = new Set(prev);
      next.delete(template.id);
      return next;
    });
    setTemplates((prev) => prev.filter((_, i) => i !== templateIndex));
  };

  const removeStep = (templateIndex: number, stepIndex: number) => {
    setTemplates((prev) =>
      prev.map((t, i) =>
        i === templateIndex
          ? {
              ...t,
              steps: t.steps.filter((_, j) => j !== stepIndex),
            }
          : t
      )
    );
  };

  const addStep = (templateIndex: number) => {
    setTemplates((prev) =>
      prev.map((t, i) =>
        i === templateIndex ? { ...t, steps: [...t.steps, ""] } : t
      )
    );
  };

  const updateStep = (templateIndex: number, stepIndex: number, value: string) => {
    setTemplates((prev) => {
      const next = prev.map((t, i) =>
        i === templateIndex
          ? {
              ...t,
              steps: t.steps.map((s, j) => (j === stepIndex ? value : s)),
            }
          : t
      );
      return next;
    });
  };

  const updateTemplateName = (templateIndex: number, name: string) => {
    setTemplates((prev) =>
      prev.map((t, i) => (i === templateIndex ? { ...t, name } : t))
    );
  };

  const openStepModal = (templateIndex: number, stepIndex: number) => {
    const value =
      templates[templateIndex]?.steps[stepIndex] ?? "";
    setModalValue(value);
    setModalSource({ templateIndex, stepIndex });
    setModalOpen(true);
  };

  const closeModal = () => {
    if (modalSource !== null) {
      updateStep(modalSource.templateIndex, modalSource.stepIndex, modalValue);
      setModalSource(null);
    }
    setModalOpen(false);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background text-foreground">
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-foreground/10 bg-foreground/5">
        <label htmlFor="scripting-model" className="text-sm text-muted-foreground">
          Model
        </label>
        <select
          id="scripting-model"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
        >
          {MODEL_OPTIONS.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 overflow-auto p-6">
      <ul className="flex flex-col gap-8 list-none p-0 m-0">
        {templates.map((template, templateIndex) => (
          <li key={template.id} className="flex flex-col gap-2">
            <div className="text-sm text-muted-foreground font-medium flex items-center gap-2">
              <button
                type="button"
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground/40 hover:text-foreground transition-colors shrink-0"
                title="Remove"
                onClick={() => removeTemplate(templateIndex)}
              >
                <RemoveIcon />
              </button>
              <button
                type="button"
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground/40 hover:text-foreground transition-colors shrink-0"
                title={hiddenTemplateIds.has(template.id) ? "Show" : "Hide"}
                onClick={() => toggleTemplateHidden(template.id)}
              >
                {hiddenTemplateIds.has(template.id) ? (
                  <UnhideIcon />
                ) : (
                  <HideIcon />
                )}
              </button>
              <input
                type="text"
                className="min-w-[2ch] max-w-[12rem] bg-transparent border-b border-current text-foreground focus:outline-none focus:ring-0 px-0.5 border-foreground/0 focus:border-foreground"
                value={template.name}
                onChange={(e) =>
                  updateTemplateName(templateIndex, e.target.value)
                }
              />
            </div>
            {!hiddenTemplateIds.has(template.id) && (
            <div className="flex flex-wrap items-stretch gap-2">
              {template.steps.map((stepValue, stepIndex) => (
                <span key={stepIndex} className="contents">
                  <div className="flex flex-col border border-border border-foreground/10 rounded-lg bg-foreground/5 overflow-hidden min-w-[200px] w-[280px] focus:border-foreground">
                    <textarea
                      className="flex-1 min-h-[100px] p-3 resize-y bg-transparent text-foreground placeholder:text-muted-foreground border-0 focus:outline-none focus:ring-0"
                      value={stepValue}
                      onChange={(e) =>
                        updateStep(templateIndex, stepIndex, e.target.value)
                      }
                    />
                    <div className="flex justify-between items-center gap-1 px-2 pb-2">
                      <button
                        type="button"
                        className="p-2 rounded-md hover:bg-muted text-muted-foreground/40 hover:text-foreground transition-colors"
                        title="Remove"
                        onClick={() => removeStep(templateIndex, stepIndex)}
                      >
                        <RemoveIcon />
                      </button>
                      <div className="flex gap-1 ml-auto">
                        <button
                          type="button"
                          className="p-2 rounded-md hover:bg-muted text-muted-foreground/40 hover:text-foreground transition-colors"
                          title="Open"
                          onClick={() => openStepModal(templateIndex, stepIndex)}
                        >
                          <FullScreenIcon />
                        </button>
                        <button
                          type="button"
                          className="p-2 rounded-md hover:bg-muted text-muted-foreground/40 hover:text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
                          title="Generate"
                          disabled={
                            generatingStep?.templateIndex === templateIndex &&
                            generatingStep?.stepIndex === stepIndex
                          }
                          onClick={() => handleGenerate(templateIndex, stepIndex)}
                        >
                          {generatingStep?.templateIndex === templateIndex &&
                          generatingStep?.stepIndex === stepIndex ? (
                            <LoaderIcon />
                          ) : (
                            <SendIcon />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                  {stepIndex < template.steps.length - 1 && (
                    <span className="self-center text-muted-foreground flex items-center shrink-0 opacity-40" aria-hidden>
                      <svg width="64" height="16" viewBox="0 0 64 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-current">
                        <path d="M4 8h56m0 0l-6-6m6 6l-6 6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                </span>
              ))}
              {template.steps.length > 0 && (
                <span className="self-center text-muted-foreground flex items-center shrink-0 opacity-40" aria-hidden>
                  <svg width="64" height="16" viewBox="0 0 64 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-current">
                    <path d="M4 8h56m0 0l-6-6m6 6l-6 6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
              <button
                type="button"
                className="flex flex-col min-w-[200px] w-[280px] min-h-[164px] rounded-lg border border-dashed border-foreground/10 hover:bg-muted/50 hover:border-foreground/30 text-muted-foreground/10 hover:text-foreground transition-colors items-center justify-center shrink-0"
                title="Add step"
                onClick={() => addStep(templateIndex)}
              >
                <span className="text-2xl leading-none">+</span>
              </button>
            </div>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <button
          type="button"
          className="p-2 rounded-md border border-dashed border-border hover:bg-muted text-muted-foreground/40 hover:text-foreground transition-colors flex items-center justify-center min-w-[2.5rem]"
          title="Add template"
          onClick={addTemplate}
        >
          <span className="text-xl leading-none">+</span>
        </button>
      </div>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={closeModal}
        >
          <div
            className="bg-[#222222] border border-foreground/10 rounded-lg shadow-lg w-[90vw] max-w-2xl h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <textarea
              className="flex-1 min-h-0 p-3 resize-none bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0"
              placeholder="Step content..."
              value={modalValue}
              onChange={(e) => setModalValue(e.target.value)}
            />
            <div className="flex justify-end pt-2">
              <button
                type="button"
                className="px-4 py-2 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground/40 hover:text-foreground transition-colors"
                onClick={closeModal}
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
