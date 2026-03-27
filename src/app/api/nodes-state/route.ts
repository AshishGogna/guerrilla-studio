import { NextRequest, NextResponse } from "next/server";
import { loadNodesJson, saveNodesJson } from "@/lib/file-storage";

type NodesStateFile = {
  nodes: unknown[];
  edges: unknown[];
};

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId") || "";
  if (!projectId.trim()) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }
  try {
    const data = await loadNodesJson<NodesStateFile>(projectId.trim());
    return NextResponse.json(data ?? { nodes: [], edges: [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load nodes state" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: { projectId?: string; state?: NodesStateFile };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }
  const state = body.state;
  if (!state || !Array.isArray(state.nodes) || !Array.isArray(state.edges)) {
    return NextResponse.json({ error: "Missing state.nodes/state.edges" }, { status: 400 });
  }
  try {
    await saveNodesJson(projectId, state);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save nodes state" },
      { status: 500 }
    );
  }
}

