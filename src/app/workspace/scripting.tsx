"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

interface ScriptData {
  content: string;
  lastSaved: string;
}

export default function ScriptingComponent() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") || "";

  const [script, setScript] = useState<ScriptData>({
    content: "",
    lastSaved: ""
  });

  // Load script from localStorage on mount
  useEffect(() => {
    if (projectId) {
      const savedScript = localStorage.getItem(`script-${projectId}`);
      if (savedScript) {
        setScript({
          content: savedScript,
          lastSaved: new Date().toISOString()
        });
      }
    }
  }, [projectId]);

  // Auto-save script to localStorage
  useEffect(() => {
    if (projectId && script.content) {
      const saveTimer = setTimeout(() => {
        localStorage.setItem(`script-${projectId}`, script.content);
        setScript(prev => ({
          ...prev,
          lastSaved: new Date().toISOString()
        }));
      }, 1000);
      
      return () => clearTimeout(saveTimer);
    }
  }, [script.content, projectId]);

  const handleScriptChange = (value: string) => {
    setScript(prev => ({
      ...prev,
      content: value
    }));
  };

  const getLastSavedTime = () => {
    if (script.lastSaved) {
      return new Date(script.lastSaved).toLocaleString();
    }
    return "Not saved yet";
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex flex-col">
        {/* Script Editor */}
        <div className="flex-1 p-4">
          <textarea
            value={script.content}
            onChange={(e) => handleScriptChange(e.target.value)}
            placeholder="Start writing your script here..."
            className="w-full h-full resize-none border-0 bg-transparent text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-0 font-mono text-sm leading-relaxed"
            style={{ 
              fontFamily: "Cursor, var(--font-mono), ui-monospace, monospace",
              lineHeight: "1.6"
            }}
          />
        </div>
      </div>
    </div>
  );
}
