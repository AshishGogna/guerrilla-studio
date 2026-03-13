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

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  let body: { userPrompt?: string; systemPrompt?: string; model?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const userPrompt = typeof body.userPrompt === "string" ? body.userPrompt : "";
  if (!userPrompt.trim()) {
    return NextResponse.json(
      { error: "userPrompt is required" },
      { status: 400 }
    );
  }

  const systemPrompt =
    typeof body.systemPrompt === "string" && body.systemPrompt.trim()
      ? body.systemPrompt.trim()
      : "";

  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : "gpt-5-mini-2025-08-07";

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
        input: userPrompt,
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
