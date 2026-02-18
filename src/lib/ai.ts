const MODEL = "gpt-5-mini-2025-08-07";
const IMAGE_MODEL = "gemini-2.5-flash-image";

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
): Promise<string[]> {

  // return [
  //   "SCENE 1",
  //   "SCENE 2",
  //   "SCENE 2",
  //   "SCENE 2",
  //   "SCENE 2",
  //   "SCENE 2",
  //   "SCENE 2",
  //   "SCENE 2",
  //   "SCENE 2",
  // ];

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

  const prompts = JSON.parse(data.content);
  return prompts.prompts;
}

export async function generatePanelImage(prompt: string, projectId: string, imageNumber: number): Promise<string> {
  const res = await fetch("/api/generate-panel-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model: IMAGE_MODEL, projectId, imageNumber }),
  });

  const data = await res.json();

  if (!res.ok) {
    const message = typeof data?.error === "string" ? data.error : "Failed to generate panel image";
    throw new Error(message);
  }

  if (typeof data?.content !== "string") {
    throw new Error("Invalid response from server");
  }

  console.log('AI: generatePanelImage response:', data.content);
  return data.content;
}