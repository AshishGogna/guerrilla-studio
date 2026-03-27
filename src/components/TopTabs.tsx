"use client";

import { useEffect, useState } from "react";
import Editor, { type EditorProps } from "./Editor";
import Metadata, { type MetadataProps } from "./Metadata";
import Nodes from "./Nodes";
import Scripting from "./Scripting";
import Storyboarding, { type StoryboardingProps } from "./Storyboarding";
import World, { type WorldProps } from "./World";

type TabId = "nodes" | "world" | "scripting" | "storyboarding" | "editing" | "metadata";

const TABS: { id: TabId; label: string }[] = [
  { id: "nodes", label: "Nodes" },
  { id: "world", label: "World" },
  { id: "scripting", label: "Scripting" },
  { id: "storyboarding", label: "Storyboarding" },
  { id: "editing", label: "Video Editing" },
  // { id: "metadata", label: "Metadata" },
];

type Props = { projectId: string };

export default function TopTabs({ projectId }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("world");

  useEffect(() => {
    const tabKey = `guerrilla-studio:activeTab:${projectId}`;
    const read = () => {
      const v = localStorage.getItem(tabKey) as TabId | null;
      if (v && TABS.some((t) => t.id === v)) setActiveTab(v);
    };
    read();
    const onStorage = (e: StorageEvent) => {
      if (e.key === tabKey) read();
    };
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId?: string; tab?: TabId }>).detail;
      if (!detail || detail.projectId !== projectId) return;
      const t = detail.tab;
      if (t && TABS.some((x) => x.id === t)) setActiveTab(t);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("guerrilla-studio:setActiveTab", onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("guerrilla-studio:setActiveTab", onCustom as EventListener);
    };
  }, [projectId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 border-b border-foreground/10 bg-background">
        <div className="flex w-full">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setActiveTab(id);
                try {
                  const tabKey = `guerrilla-studio:activeTab:${projectId}`;
                  localStorage.setItem(tabKey, id);
                } catch {
                  // ignore
                }
              }}
              className={`flex flex-1 items-center justify-center px-4 py-3 text-sm font-medium transition ${
                activeTab === id
                  ? "border-b-2 border-accent text-foreground"
                  : "text-foreground/60 hover:text-foreground/80"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {activeTab === "nodes" && <Nodes projectId={projectId} />}
        {activeTab === "world" && <World projectId={projectId} />}
        {activeTab === "scripting" && <Scripting projectId={projectId} />}
        {activeTab === "storyboarding" && <Storyboarding projectId={projectId} />}
        {activeTab === "editing" && <Editor projectId={projectId} />}
        {activeTab === "metadata" && <Metadata projectId={projectId} />}
      </div>
    </div>
  );
}
