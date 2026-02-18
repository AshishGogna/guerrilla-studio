import { NextResponse } from "next/server";

function extractTextFromResponsesOutput(output: unknown): string | null {
  if (!Array.isArray(output)) return null;
  const parts: string[] = [];
  for (const item of output) {
    const content = item?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === "output_text" && typeof block?.text === "string") {
        parts.push(block.text);
      }
    }
  }
  if (parts.length === 0) return null;
  return parts.join("");
}

const DEFAULT_SYSTEM_PROMPT =
  "You are a storyboard assistant. Given a script, output a JSON array of panel prompts: one short visual/action prompt per panel. Output only valid JSON, no other text. Example: [{\"panel\": 1, \"prompt\": \"...\"}, {\"panel\": 2, \"prompt\": \"...\"}].";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  let body: { script?: string; systemPrompt?: string; model?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const script = typeof body.script === "string" ? body.script : "";
  if (!script.trim()) {
    return NextResponse.json(
      { error: "script is required" },
      { status: 400 }
    );
  }

  const systemPrompt =
    typeof body.systemPrompt === "string" && body.systemPrompt.trim()
      ? body.systemPrompt.trim()
      : DEFAULT_SYSTEM_PROMPT;

  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : "gpt-4o-mini";

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: systemPrompt,
        input: script,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const message =
        data?.error?.message ?? data?.message ?? `OpenAI API error: ${res.status}`;
      return NextResponse.json({ error: message }, { status: res.status });
    }

    const content = extractTextFromResponsesOutput(data?.output);
    if (content === null) {
      return NextResponse.json(
        { error: "Unexpected response from OpenAI" },
        { status: 500 }
      );
    }

    return NextResponse.json({ content });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
