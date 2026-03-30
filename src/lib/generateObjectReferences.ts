import { generateImage } from "@/lib/ai";
import { addData, getData } from "@/lib/data";

export type GenerateObjectReferencesOptions = {
  aspectRatio: string;
  imageModel: string;
};

/**
 * Reads `references` from project data, generates an image per entry with id + imageGenerationPrompt,
 * and stores the result path under each id (same behavior as World → Generate Object References).
 */
export async function generateObjectReferences(
  projectId: string,
  options: GenerateObjectReferencesOptions
): Promise<void> {
  let raw: unknown = getData(projectId, "references");
  if (!Array.isArray(raw)) {
    try {
      raw = JSON.parse(String(raw ?? "null")) as unknown;
    } catch {
      raw = null;
    }
    if (!Array.isArray(raw)) {
      throw new Error(
        "No object references found. Save an array under the key `references` in project data (items with id + imageGenerationPrompt)."
      );
    }
  }

  const refs = raw as unknown[];
  const parsed = refs
    .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : null))
    .filter(Boolean)
    .map((r) => ({
      id: typeof r!.id === "string" ? r!.id : "",
      imageGenerationPrompt:
        typeof r!.imageGenerationPrompt === "string" ? r!.imageGenerationPrompt : "",
    }))
    .filter((r) => r.id.trim() && r.imageGenerationPrompt.trim());

  if (parsed.length === 0) {
    throw new Error(
      "references is empty or invalid. Expected items like { id, imageGenerationPrompt }."
    );
  }

  const { aspectRatio, imageModel } = options;

  for (const obj of parsed) {
    const fileName = `object-${obj.id}`;
    const imagePath = await generateImage(
      obj.imageGenerationPrompt,
      projectId,
      fileName,
      aspectRatio,
      undefined,
      imageModel
    );
    addData(projectId, obj.id, imagePath);
  }
}
