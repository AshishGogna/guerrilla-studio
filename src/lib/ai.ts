export async function generateScript(
  world: string,
  systemPrompt: string
): Promise<string> {

  console.log('AI: generateScript:', world, systemPrompt);

  const model = "gpt-5.2-pro-2025-12-11";

  const res = await fetch("/api/generate-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ world, systemPrompt }),
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
