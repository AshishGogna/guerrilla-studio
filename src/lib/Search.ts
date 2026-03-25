const MODEL = "gpt-5-mini-2025-08-07";

export function searchImage(query: string): void {
  console.log("[searchImage] triggered", { query });
  search(query);
}

export async function search(
  query: string,
): Promise<string> {
  const textModel = MODEL;
  const tools = JSON.stringify([{type:"web_search"}]);
  console.log('Search: search:', query);
  const res = await fetch("/api/generate-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userPrompt: query, systemPrompt: "Find one image url for the user's query.", model: textModel, tools }),
  });

  const data = await res.json();

  if (!res.ok) {
    const message = typeof data?.error === "string" ? data.error : "Failed to generate text";
    throw new Error(message);
  }

  if (typeof data?.content !== "string") {
    throw new Error("Invalid response from server");
  }

  console.log('Search: search response:', data.content);
  return data.content;
}