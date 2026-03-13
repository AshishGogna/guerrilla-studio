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

export interface EditorState {
  clips: unknown[];
}

export interface EditorSubtitleSettings {
  textSize: number;
  textColor: string;
  backgroundColor: string;
  width: number;
  positionX: number;
  positionY: number;
  borderColor: string;
  highlightTextColor: string;
  highlightBgColor: string;
}

const DEFAULT_SUBTITLE_SETTINGS: EditorSubtitleSettings = {
  textSize: 24,
  textColor: "#ffffff",
  backgroundColor: "#000000",
  width: 800,
  positionX: 960,
  positionY: 324,
  borderColor: "#ffffff",
  highlightTextColor: "#ffff00",
  highlightBgColor: "#000000",
};

export function loadEditorState(projectId: string): EditorState {
  try {
    const raw = localStorage.getItem(getStorageKey(projectId, "editor-clips"));
    if (raw) {
      const clips = JSON.parse(raw) as unknown[];
      return { clips };
    }
  } catch {
    // ignore
  }
  return { clips: [] };
}

export function saveEditorState(projectId: string, state: EditorState): void {
  try {
    localStorage.setItem(
      getStorageKey(projectId, "editor-clips"),
      JSON.stringify(state.clips)
    );
  } catch {
    // ignore
  }
}

export function loadEditorSubtitleSettings(projectId: string): EditorSubtitleSettings {
  try {
    const raw = localStorage.getItem(getStorageKey(projectId, "editor-subtitle-settings"));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<EditorSubtitleSettings>;
      return {
        textSize: typeof parsed.textSize === "number" ? parsed.textSize : DEFAULT_SUBTITLE_SETTINGS.textSize,
        textColor: typeof parsed.textColor === "string" ? parsed.textColor : DEFAULT_SUBTITLE_SETTINGS.textColor,
        backgroundColor: typeof parsed.backgroundColor === "string" ? parsed.backgroundColor : DEFAULT_SUBTITLE_SETTINGS.backgroundColor,
        width: typeof parsed.width === "number" ? parsed.width : (typeof (parsed as { maxWidth?: number }).maxWidth === "number" ? (parsed as { maxWidth: number }).maxWidth : DEFAULT_SUBTITLE_SETTINGS.width),
        positionX: typeof parsed.positionX === "number" ? parsed.positionX : DEFAULT_SUBTITLE_SETTINGS.positionX,
        positionY: typeof parsed.positionY === "number" ? parsed.positionY : DEFAULT_SUBTITLE_SETTINGS.positionY,
        borderColor: typeof parsed.borderColor === "string" ? parsed.borderColor : DEFAULT_SUBTITLE_SETTINGS.borderColor,
        highlightTextColor: typeof parsed.highlightTextColor === "string" ? parsed.highlightTextColor : DEFAULT_SUBTITLE_SETTINGS.highlightTextColor,
        highlightBgColor: typeof parsed.highlightBgColor === "string" ? parsed.highlightBgColor : DEFAULT_SUBTITLE_SETTINGS.highlightBgColor,
      };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SUBTITLE_SETTINGS };
}

export function saveEditorSubtitleSettings(projectId: string, settings: EditorSubtitleSettings): void {
  try {
    localStorage.setItem(
      getStorageKey(projectId, "editor-subtitle-settings"),
      JSON.stringify(settings)
    );
  } catch {
    // ignore
  }
}

export interface EditorTransformSettings {
  zoom: string;
  compWidth: string;
  compHeight: string;
}

const DEFAULT_TRANSFORM_SETTINGS: EditorTransformSettings = {
  zoom: "1",
  compWidth: "1920",
  compHeight: "1080",
};

export function loadEditorTransformSettings(projectId: string): EditorTransformSettings {
  try {
    const raw = localStorage.getItem(getStorageKey(projectId, "editor-transform-settings"));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<EditorTransformSettings>;
      return {
        zoom: typeof parsed.zoom === "string" ? parsed.zoom : DEFAULT_TRANSFORM_SETTINGS.zoom,
        compWidth: typeof parsed.compWidth === "string" ? parsed.compWidth : DEFAULT_TRANSFORM_SETTINGS.compWidth,
        compHeight: typeof parsed.compHeight === "string" ? parsed.compHeight : DEFAULT_TRANSFORM_SETTINGS.compHeight,
      };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_TRANSFORM_SETTINGS };
}

export function saveEditorTransformSettings(projectId: string, settings: EditorTransformSettings): void {
  try {
    localStorage.setItem(
      getStorageKey(projectId, "editor-transform-settings"),
      JSON.stringify(settings)
    );
  } catch {
    // ignore
  }
}

export interface ScriptingTemplate {
  id: string;
  name: string;
  steps: string[];
}

export interface ScriptingState {
  templates: ScriptingTemplate[];
  hiddenTemplateIds: string[];
}

export function loadScriptingState(projectId: string): ScriptingState {
  try {
    const raw = localStorage.getItem(getStorageKey(projectId, "scripting"));
    if (raw) {
      const parsed = JSON.parse(raw) as { templates?: unknown[]; hiddenTemplateIds?: string[] };
      const templates = Array.isArray(parsed.templates)
        ? parsed.templates.filter(
            (t): t is ScriptingTemplate =>
              t != null &&
              typeof (t as ScriptingTemplate).id === "string" &&
              typeof (t as ScriptingTemplate).name === "string" &&
              Array.isArray((t as ScriptingTemplate).steps)
          )
        : [];
      const hiddenTemplateIds = Array.isArray(parsed.hiddenTemplateIds)
        ? parsed.hiddenTemplateIds.filter((id) => typeof id === "string")
        : [];
      return { templates, hiddenTemplateIds };
    }
  } catch {
    // ignore
  }
  return { templates: [], hiddenTemplateIds: [] };
}

export function saveScriptingState(projectId: string, state: ScriptingState): void {
  try {
    localStorage.setItem(
      getStorageKey(projectId, "scripting"),
      JSON.stringify({
        templates: state.templates,
        hiddenTemplateIds: state.hiddenTemplateIds,
      })
    );
  } catch {
    // ignore
  }
}
