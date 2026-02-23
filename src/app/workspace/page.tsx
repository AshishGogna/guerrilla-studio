"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ScriptingComponent from "./scripting";
import StoryboardingComponent from "./storyboarding";

export default function WorkspacePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = searchParams.get("projectId") || "";
  const [activeView, setActiveView] = useState<string>("");

  if (!projectId) {
    return (
      <div className="min-h-screen bg-background text-foreground p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">No Project Selected</h1>
          <p className="text-foreground/60">Please select a project from the projects page.</p>
          <button 
            onClick={() => router.push('/projects')}
            className="mt-4 px-4 py-2 bg-accent text-background rounded hover:bg-accent-muted transition"
          >
            Go to Projects
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Bar */}
      <header className="h-14 border-b border-foreground/10">
        <div className="h-full max-w-7xl mx-auto px-4 flex">
          <div className="flex items-center h-full justify-between flex-1">
            <button 
              onClick={() => setActiveView("scripting")}
              className={`text-sm font-medium transition-colors ${
                activeView === "scripting" 
                  ? "text-foreground" 
                  : "text-foreground/80 hover:text-foreground"
              }`}
            >
              Scripting
            </button>
            <button 
              onClick={() => setActiveView("storyboarding")}
              className={`text-sm font-medium transition-colors ${
                activeView === "storyboarding" 
                  ? "text-foreground" 
                  : "text-foreground/80 hover:text-foreground"
              }`}
            >
              Storyboarding
            </button>
            <button className="text-sm font-medium text-foreground/80 hover:text-foreground transition-colors">
              Music
            </button>
            <button className="text-sm font-medium text-foreground/80 hover:text-foreground transition-colors">
              Video
            </button>
            <button className="text-sm font-medium text-foreground/80 hover:text-foreground transition-colors">
              Settings
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      {activeView === "scripting" ? (
        <div className="h-[calc(100vh-3.5rem)]">
          <ScriptingComponent />
        </div>
      ) : activeView === "storyboarding" ? (
        <div className="h-[calc(100vh-3.5rem)]">
          <StoryboardingComponent />
        </div>
      ) : (
        <main className="max-w-7xl mx-auto p-4">
          <div className="text-center py-20">
            <h2 className="text-2xl font-semibold text-foreground mb-4">
              Workspace for {projectId}
            </h2>
            <p className="text-foreground/60">
              Click "Scripting" or "Storyboarding" to start working.
            </p>
          </div>
        </main>
      )}
    </div>
  );
}
