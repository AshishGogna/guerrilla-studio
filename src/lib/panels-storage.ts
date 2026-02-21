const STORAGE_PREFIX = "guerrilla-studio:project";

function getStorageKey(projectId: string, panel: string): string {
  return `${STORAGE_PREFIX}-${projectId}:${panel}`;
}

export interface PanelData {
  script: string;
  worldAndCharacters: string;
  systemPromptWorldAndCharacters: string;
  systemPromptScript: string;
  panelPrompts: {script_part: string; panel_prompt: string; video_prompt: string}[];
  panelImages: string[];
  characters: {name: string; imagePrompt: string; image?: string}[];
  attachedImages: {[key: number]: {fileName: string; base64: string}[]};
  locations: {name: string; imagePrompt: string; image?: string}[];
};

export function loadPanelData(projectId: string): PanelData {
  try {
    const script = localStorage.getItem(getStorageKey(projectId, "script")) ?? "";
    const worldAndCharacters =
      localStorage.getItem(getStorageKey(projectId, "world-and-characters")) ?? "";
    const systemPromptWorldAndCharacters =
      localStorage.getItem(getStorageKey(projectId, "system-prompt:world-and-characters")) ?? "";
    const systemPromptScript =
      localStorage.getItem(getStorageKey(projectId, "system-prompt:script")) ?? "";
    const panelPrompts = JSON.parse(
      localStorage.getItem(getStorageKey(projectId, "panel-prompts")) ?? "[]"
    ) as {script_part: string; panel_prompt: string; video_prompt: string}[];
    const panelImages = JSON.parse(
      localStorage.getItem(getStorageKey(projectId, "panel-images")) ?? "[]"
    ) as string[];
    const characters = JSON.parse(localStorage.getItem(getStorageKey(projectId, "characters")) ?? "[]");
    console.log("Loaded characters from storage:", characters);
    const attachedImages = JSON.parse(localStorage.getItem(getStorageKey(projectId, "attached-images")) ?? "{}");
    const locations = JSON.parse(localStorage.getItem(getStorageKey(projectId, "locations")) ?? "[]");
    return {
      script,
      worldAndCharacters,
      systemPromptWorldAndCharacters,
      systemPromptScript,
      panelPrompts,
      panelImages,
      characters,
      attachedImages,
      locations
    };
  } catch {
    return {
      script: "",
      worldAndCharacters: "",
      systemPromptWorldAndCharacters: "",
      systemPromptScript: "",
      panelPrompts: [] as {script_part: string; panel_prompt: string; video_prompt: string}[],
      panelImages: [],
      characters: [{name: "", imagePrompt: ""}],
      attachedImages: {},
      locations: [{name: "", imagePrompt: ""}]
    };
  }
}

export function savePanelData(projectId: string, data: PanelData): void {
  try {
    localStorage.setItem(getStorageKey(projectId, "script"), data.script);
    localStorage.setItem(
      getStorageKey(projectId, "world-and-characters"),
      data.worldAndCharacters
    );
    localStorage.setItem(
      getStorageKey(projectId, "system-prompt:world-and-characters"),
      data.systemPromptWorldAndCharacters
    );
    localStorage.setItem(
      getStorageKey(projectId, "system-prompt:script"),
      data.systemPromptScript
    );
    localStorage.setItem(
      getStorageKey(projectId, "panel-prompts"),
      JSON.stringify(data.panelPrompts)
    );
    localStorage.setItem(
      getStorageKey(projectId, "panel-images"),
      JSON.stringify(data.panelImages)
    );
    localStorage.setItem(
      getStorageKey(projectId, "characters"),
      JSON.stringify(data.characters)
    );
    localStorage.setItem(
      getStorageKey(projectId, "attached-images"),
      JSON.stringify(data.attachedImages)
    );
    localStorage.setItem(
      getStorageKey(projectId, "locations"),
      JSON.stringify(data.locations)
    );
  } catch {
    // ignore
  }
}
