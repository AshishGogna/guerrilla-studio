import { spawn } from "child_process";
import path from "path";

/** Agentic edit can run for a long time (Claude / Remotion / etc.). */
export const maxDuration = 36000;

const SESSION_CHARS = "abcdefghijklmnopqrstuvwxyz";

function randomSessionId(): string {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += SESSION_CHARS[Math.floor(Math.random() * SESSION_CHARS.length)]!;
  }
  return s;
}

function resolveEditorRoot(): string {
  const fromEnv = process.env.GUERRILLA_AI_VIDEO_EDITOR_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), "..", "guerrilla-ai-video-editor");
}

function runGuerrillaEdit(
  editorRoot: string,
  sessionId: string,
  prompt: string,
  output: "fcpxml" | "video"
): Promise<void> {
  return new Promise((resolve, reject) => {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(
      npm,
      ["run", "guerrilla:edit", "--", sessionId, `--output=${output}`, prompt],
      {
        cwd: editorRoot,
        stdio: ["ignore", "inherit", "inherit"],
        env: { ...process.env },
      }
    );

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `npm run guerrilla:edit exited with code ${code ?? "null"}${signal ? ` (signal ${signal})` : ""}`
        )
      );
    });
  });
}

/**
 * POST { prompt: string, sessionId?: string, outputType?: "fcpxml" | "video" }
 * Runs `npm run guerrilla:edit -- <sessionId> <prompt>` in guerrilla-ai-video-editor.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionIdRaw =
    typeof (body as { sessionId?: unknown })?.sessionId === "string"
      ? (body as { sessionId: string }).sessionId.trim()
      : "";
  const outputTypeRaw =
    typeof (body as { outputType?: unknown })?.outputType === "string"
      ? (body as { outputType: string }).outputType.trim()
      : "";
  const outputType: "fcpxml" | "video" =
    outputTypeRaw === "fcpxml" || outputTypeRaw === "video" ? outputTypeRaw : "video";
  const prompt =
    typeof (body as { prompt?: unknown })?.prompt === "string"
      ? (body as { prompt: string }).prompt.trim()
      : "";

  if (!prompt) {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }

  const editorRoot = resolveEditorRoot();
  const sessionId = sessionIdRaw || randomSessionId();

  try {
    await runGuerrillaEdit(editorRoot, sessionId, prompt, outputType);
  } catch (err) {
    console.error("[agentic-edit]", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Agentic edit failed" },
      { status: 500 }
    );
  }

  return Response.json({ ok: true, sessionId, editorRoot, outputType });
}
