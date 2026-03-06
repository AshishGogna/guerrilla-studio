"use client";

import TopBar from "@/components/TopBar";
import TopTabs from "@/components/TopTabs";

export default function PanelsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <TopBar title="Panels" />
      <TopTabs />
    </div>
  );
}
