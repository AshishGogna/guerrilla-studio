import { generateImage } from "@/lib/ai";
import { addData, getData } from "@/lib/data";

function normalizePublicAssetUrl(url: string | null): string | null {
  if (url == null || url === "") return url;
  if (
    url.startsWith("/") ||
    url.startsWith("blob:") ||
    url.startsWith("data:") ||
    url.startsWith("http://") ||
    url.startsWith("https://")
  ) {
    return url;
  }
  return `/${url}`;
}

async function fetchUrlAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${url}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function resolveAttachmentUrl(projectId: string, pathValue: string): Promise<string> {
  let url = pathValue.trim();
  if (url.startsWith("file://")) {
    const res = await fetch("/api/upload-from-path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, filePath: url }),
    });
    const data = await res.json();
    if (!res.ok || typeof data?.filePath !== "string") {
      throw new Error(
        typeof data?.error === "string"
          ? data.error
          : `Failed to import attachment from local path: ${url}`
      );
    }
    url = data.filePath;
  }
  return normalizePublicAssetUrl(url) ?? url;
}

async function resolveAttachmentImages(
  projectId: string,
  attachmentKeys: string[]
): Promise<{ fileName: string; base64: string }[] | undefined> {
  if (attachmentKeys.length === 0) return undefined;
  return Promise.all(
    attachmentKeys.map(async (dataKey, i) => {
      const pathVal = getData(projectId, dataKey);
      if (typeof pathVal !== "string" || !pathVal.trim()) {
        throw new Error(
          `references attachment key "${dataKey}" is missing or not a filepath string in project data.`
        );
      }
      const trimmed = pathVal.trim();
      const url = await resolveAttachmentUrl(projectId, trimmed);
      const base64 = await fetchUrlAsBase64(url);
      const fileName =
        trimmed.split("/").pop()?.split("?")[0] || `attachment-${i}.png`;
      return { fileName, base64 };
    })
  );
}

export type GenerateObjectReferencesOptions = {
  aspectRatio: string;
  imageModel: string;
};

/**
 * Reads `references` from project data, generates an image per entry with id + imageGenerationPrompt,
 * optional `attachments` (data keys whose values are image file paths are fetched and sent as reference images),
 * and stores the result path under each id (same behavior as World → Generate Object References).
 */
export async function generateObjectReferences(
  projectId: string,
  options: GenerateObjectReferencesOptions
): Promise<void> {
  let raw: unknown = getData(projectId, "references");
  if (!Array.isArray(raw)) {
    raw = JSON.parse(String(raw ?? "null"));
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
  }

  const refs = raw as unknown[];
  const parsed = refs
    .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : null))
    .filter(Boolean)
    .map((r) => {
      const att = r!.attachments;
      const attachmentKeys = Array.isArray(att)
        ? att.filter((x): x is string => typeof x === "string" && x.trim() !== "")
        : [];
      return {
        id: typeof r!.id === "string" ? r!.id : "",
        imageGenerationPrompt:
          typeof r!.imageGenerationPrompt === "string" ? r!.imageGenerationPrompt : "",
        attachmentKeys,
      };
    })
    .filter((r) => r.id.trim() && r.imageGenerationPrompt.trim());

  if (parsed.length === 0) {
    throw new Error(
      "references is empty or invalid. Expected items like { id, imageGenerationPrompt, attachments?: string[] }."
    );
  }

  const { aspectRatio, imageModel } = options;

  for (const obj of parsed) {
    const fileName = `object-${obj.id}`;
    const attachedImages = await resolveAttachmentImages(projectId, obj.attachmentKeys);
    const imagePath = await generateImage(
      obj.imageGenerationPrompt,
      projectId,
      fileName,
      aspectRatio,
      attachedImages,
      imageModel
    );
    addData(projectId, obj.id, imagePath);
  }
}
