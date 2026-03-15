import TopBar from "@/components/TopBar";
import TopTabs from "@/components/TopTabs";

type Props = { params: Promise<{ projectId: string }> };

export default async function PanelsProjectPage({ params }: Props) {
  const { projectId } = await params;
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <TopBar title="Panels" projectId={projectId} />
      <TopTabs projectId={projectId} />
    </div>
  );
}
