const STORAGE_PREFIX = "guerrilla-studio:project";

function getStorageKey(projectId: string, panel: string): string {
  return `${STORAGE_PREFIX}-${projectId}:${panel}`;
}

export type PanelData = {
  script: string;
  worldAndCharacters: string;
  systemPromptWorldAndCharacters: string;
  systemPromptScript: string;
  panelPrompts: string[];
  panelImages: string[];
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
    const panelPrompts =
      localStorage.getItem(getStorageKey(projectId, "panel-prompts")) ?? "";
    const panelImages =
      localStorage.getItem(getStorageKey(projectId, "panel-images")) ?? "";
    return {
      script,
      worldAndCharacters,
      systemPromptWorldAndCharacters,
      systemPromptScript,
      panelPrompts: JSON.parse(panelPrompts),
      panelImages: JSON.parse(panelImages),
    };
  } catch {
    return {
      script: "",
      worldAndCharacters: "",
      systemPromptWorldAndCharacters: "",
      systemPromptScript: "",
      panelPrompts: [],
      panelImages: [],
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
  } catch {
    // ignore
  }
}
