/** Image models used by Storyboard, References nodes, etc. */
export const NODE_IMAGE_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-3-pro-image-preview",
] as const;

export type NodeImageModel = (typeof NODE_IMAGE_MODELS)[number];
