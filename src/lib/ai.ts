const MODEL = "gpt-5-mini-2025-08-07";
const IMAGE_MODEL = "gemini-2.5-flash-image";

export async function generateText(
  userPrompt: string,
  systemPrompt: string,
  model: string
): Promise<string> {
  const textModel = model ?? MODEL;

  const tools = JSON.stringify([{type:"web_search"}]);


  console.log('AI: generateText:', userPrompt, systemPrompt, textModel);
  const res = await fetch("/api/generate-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userPrompt, systemPrompt, model: textModel, tools }),
  });

  const data = await res.json();

  if (!res.ok) {
    const message = typeof data?.error === "string" ? data.error : "Failed to generate text";
    throw new Error(message);
  }

  if (typeof data?.content !== "string") {
    throw new Error("Invalid response from server");
  }

  console.log('AI: generateText response:', data.content);
  return data.content;
}

export async function generatePanelPrompts(
  script: string,
  systemPrompt: string
): Promise<{script_part: string; panel_prompt: string; video_prompt: string}[]> {

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
  return prompts.panels; // Return the full array with script_part and panel_prompt
}

export async function generateImage(
  prompt: string,
  projectId: string,
  fileName: string,
  aspectRatio: string,
  attachedImages?: { fileName: string; base64: string }[],
  model?: string
): Promise<string> {
  const imageModel = model ?? IMAGE_MODEL;
  console.log("AI: generateImage request:", prompt, projectId, fileName, aspectRatio, imageModel, attachedImages);
  const outputFileName = `${fileName}`;
  const res = await fetch("/api/generate-panel-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model: imageModel, outputFileName, aspectRatio, attachedImages, projectId }),
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