"use client";

import { useState } from "react";
import Editor from "./Editor";
import Metadata from "./Metadata";
import Scripting from "./Scripting";
import Storyboarding from "./Storyboarding";

type TabId = "scripting" | "storyboarding" | "editing" | "metadata";

const TABS: { id: TabId; label: string }[] = [
  { id: "scripting", label: "Scripting" },
  { id: "storyboarding", label: "Storyboarding" },
  { id: "editing", label: "Editing" },
  { id: "metadata", label: "Metadata" },
];

export default function TopTabs() {
  const [activeTab, setActiveTab] = useState<TabId>("scripting");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 border-b border-foreground/10 bg-background">
        <div className="flex w-full">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
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
        {activeTab === "scripting" && <Scripting />}
        {activeTab === "storyboarding" && <Storyboarding />}
        {activeTab === "editing" && <Editor />}
        {activeTab === "metadata" && <Metadata />}
      </div>
    </div>
  );
}
