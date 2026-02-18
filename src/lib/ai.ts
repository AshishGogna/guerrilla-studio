const MODEL = "gpt-5-mini-2025-08-07";

export async function generateScript(
  world: string,
  systemPrompt: string
): Promise<string> {
  console.log('AI: generateScript:', world, systemPrompt);
  const res = await fetch("/api/generate-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ world, systemPrompt, model: MODEL }),
  });

  const data = await res.json();

  if (!res.ok) {
    const message = typeof data?.error === "string" ? data.error : "Failed to generate script";
    throw new Error(message);
  }

  if (typeof data?.content !== "string") {
    throw new Error("Invalid response from server");
  }

  console.log('AI: generateScript response:', data.content);
  return data.content;
}

export async function generatePanelPrompts(
  script: string,
  systemPrompt: string
): Promise<string> {
  const res = await fetch("/api/generate-panel-prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      script,
      systemPrompt,
      model: MODEL,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    const message =
      typeof data?.error === "string" ? data.error : "Failed to generate panel prompts";
    throw new Error(message);
  }

  if (typeof data?.content !== "string") {
    throw new Error("Invalid response from server");
  }

  console.log('AI: generatePanelPrompts response:', data.content);

  const prompts = JSON.parse(data.content);
  return data.content;
}