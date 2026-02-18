import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  let body: { world?: string; systemPrompt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const world = typeof body.world === "string" ? body.world : "";
  if (!world.trim()) {
    return NextResponse.json(
      { error: "world is required" },
      { status: 400 }
    );
  }

  const systemPrompt =
    typeof body.systemPrompt === "string" && body.systemPrompt.trim()
      ? body.systemPrompt.trim()
      : "You are a scriptwriter. Generate a script based on the user's world and characters description. Output only the script text, no meta commentary.";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: world },
        ],
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const message =
        data?.error?.message ?? data?.message ?? `OpenAI API error: ${res.status}`;
      return NextResponse.json({ error: message }, { status: res.status });
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
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
