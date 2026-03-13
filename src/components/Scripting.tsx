"use client";

import { useState } from "react";

// Fixed test data: 2 templates, 2–3 steps each
const INITIAL_TEMPLATES = [
  { id: "t1", name: "Template 1", steps: ["", ""] },
  { id: "t2", name: "Template 2", steps: ["", "", ""] },
];

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

export default function Scripting() {
  const [templates, setTemplates] = useState(INITIAL_TEMPLATES);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalValue, setModalValue] = useState("");
  const [modalSource, setModalSource] = useState<{
    templateIndex: number;
    stepIndex: number;
  } | null>(null);

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
    <div className="flex-1 bg-background text-foreground p-6 overflow-auto">
      <ul className="flex flex-col gap-8 list-none p-0 m-0">
        {templates.map((template, templateIndex) => (
          <li key={template.id} className="flex flex-col gap-2">
            <div className="text-sm text-muted-foreground font-medium flex items-baseline gap-1">
              <input
                type="text"
                className="min-w-[2ch] max-w-[12rem] bg-transparent border-b border-current text-foreground focus:outline-none focus:ring-0 px-0.5 border-foreground/10 focus:border-foreground"
                value={template.name}
                onChange={(e) =>
                  updateTemplateName(templateIndex, e.target.value)
                }
              />
            </div>
            <div className="flex flex-wrap items-stretch gap-2">
              {template.steps.map((stepValue, stepIndex) => (
                <span key={stepIndex} className="contents">
                  <div className="flex flex-col border border-border border-foreground/10 rounded-lg bg-card overflow-hidden min-w-[200px] w-[280px] focus:border-foreground">
                    <textarea
                      className="flex-1 min-h-[100px] p-3 resize-y bg-transparent text-foreground placeholder:text-muted-foreground border-0 focus:outline-none focus:ring-0"
                      value={stepValue}
                      onChange={(e) =>
                        updateStep(templateIndex, stepIndex, e.target.value)
                      }
                    />
                    <div className="flex justify-end gap-1 px-2 pb-2">
                      <button
                        type="button"
                        className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Open"
                        onClick={() => openStepModal(templateIndex, stepIndex)}
                      >
                        <FullScreenIcon />
                      </button>
                      <button
                        type="button"
                        className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Generate"
                      >
                        <SendIcon />
                      </button>
                    </div>
                  </div>
                  {stepIndex < template.steps.length - 1 && (
                    <span className="self-center text-muted-foreground font-medium">
                      →
                    </span>
                  )}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={closeModal}
        >
          <div
            className="bg-background border border-border rounded-lg shadow-lg w-[90vw] max-w-2xl h-[80vh] flex flex-col p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <textarea
              className="flex-1 min-h-0 p-3 resize-none bg-transparent text-foreground placeholder:text-muted-foreground border border-border rounded focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Step content..."
              value={modalValue}
              onChange={(e) => setModalValue(e.target.value)}
            />
            <div className="flex justify-end pt-2">
              <button
                type="button"
                className="px-4 py-2 rounded-md bg-muted hover:bg-muted/80 text-foreground"
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
