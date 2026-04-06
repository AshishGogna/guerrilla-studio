import { addData, getData } from "@/lib/data";

/**
 * Replaces `${key}` tokens with values stored in `lib/data` for that project.
 *
 * - `${foo}` -> value of data key "foo"
 * - If key is missing, replaces with empty string
 * - Non-string values are JSON-stringified
 */
export function parsePrompt(projectId: string, prompt: string): string {
  if (typeof prompt !== "string" || prompt.length === 0) return "";
  return prompt.replace(/\$\{([^{}]+)\}/g, (_match, rawKey: string) => {
    const key = String(rawKey ?? "").trim();
    if (!key) return "";
    const v = getData(projectId, key);
    if (v == null) return "";
    return typeof v === "string" ? v : JSON.stringify(v);
  });
}

/**
 * Copies the prompt with `${key}` placeholders resolved via project data (same as Play uses).
 */
export async function copyResolvedPromptToClipboard(
  projectId: string,
  rawPrompt: string
): Promise<void> {
  const text = parsePrompt(projectId, rawPrompt);
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to execCommand
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch (e) {
    console.error(e);
    alert(
      e instanceof Error ? e.message : "Could not copy to clipboard"
    );
  }
}

function parseFirstJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Try direct JSON first.
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // continue
  }

  // Try fenced code block JSON (```json ... ``` / ``` ... ```).
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    try {
      const parsed = JSON.parse(fenceMatch[1]) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // continue
    }
  }

  // Try first balanced {...} span.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const maybeJson = trimmed.slice(start, end + 1);
    try {
      const parsed = JSON.parse(maybeJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // no parseable JSON object found
    }
  }

  return null;
}

/**
 * If input text contains a JSON object, store each top-level key/value in lib/data.
 * Returns true when JSON was found and stored, otherwise false.
 */
export function parseAiResponse(projectId: string, input: unknown): boolean {
  if (input == null) return false;
  const obj =
    typeof input === "string"
      ? parseFirstJsonObject(input)
      : typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : null;
  if (!obj) return false;
  for (const [key, value] of Object.entries(obj)) {
    addData(projectId, key, value);
  }
  return true;
}

