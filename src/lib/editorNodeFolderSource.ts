/**
 * In-memory selected media files per Editor canvas node (not serializable).
 * User picks files with a normal file input; Play uploads those same File objects.
 */

const byNodeId = new Map<string, File[]>();

const MEDIA_EXT = /\.(mp4|webm|mov|mkv|avi|m4v|mp3|wav|m4a|aac|flac|ogg|opus)(\?.*)?$/i;

export function isProbablyMediaFile(file: File): boolean {
  if (file.type.startsWith("video/") || file.type.startsWith("audio/")) return true;
  return MEDIA_EXT.test(file.name);
}

function isAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  return /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(file.name);
}

export { isAudioFile };

/** Replace the in-memory file list for this node (e.g. after user picks files in the dialog). */
export function registerEditorNodeSelectedFiles(nodeId: string, files: File[]): void {
  byNodeId.set(nodeId, [...files]);
}

export function unregisterEditorNodeFolderSource(nodeId: string): void {
  byNodeId.delete(nodeId);
}

/**
 * Returns the selected media files for this node, or null if none / none pass the filter.
 */
export async function getEditorNodeMediaFiles(nodeId: string): Promise<File[] | null> {
  const files = byNodeId.get(nodeId);
  if (!files?.length) return null;
  const filtered = files.filter(isProbablyMediaFile);
  return filtered.length ? filtered : null;
}
