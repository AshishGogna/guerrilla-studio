"use client";

import { ReactNode } from "react";

interface TopBarProps {
  title?: string;
  children?: ReactNode;
}

export default function TopBar({ title = "", children }: TopBarProps) {
  return (
    <div className="shrink-0 border-b border-foreground/10 bg-background">
      <div className="flex items-center justify-between px-4 py-3">
        {title && (
          <h1 className="font-mono text-sm uppercase tracking-wider text-foreground/70">
            {title}
          </h1>
        )}
        <div className="flex items-center gap-2">
          {children}
        </div>
      </div>
    </div>
  );
}
