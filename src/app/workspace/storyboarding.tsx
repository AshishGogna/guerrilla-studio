"use client";

import { useSearchParams } from "next/navigation";

export default function StoryboardingComponent() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") || "";

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-foreground mb-4">
            Storyboarding
          </h2>
          <p className="text-foreground/60">
            Storyboarding component for project: {projectId}
          </p>
          <p className="text-foreground/40 text-sm mt-2">
            This is an empty component. Content will be added here.
          </p>
        </div>
      </div>
    </div>
  );
}
