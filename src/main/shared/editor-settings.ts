import type { EditorSettings } from "./types";

/**
 * Canonical editor defaults shared by the main process and renderer.
 *
 * Keeping this in the shared layer prevents a failed settings load from
 * silently replacing the editor's live appearance with a different fallback.
 */
export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontSize: 18,
  lineHeight: 1.82,
  autosaveMs: 1000,
  layoutPreset: "immersive",
  pageWidth: "narrow",
  fontFamily: "song",
  editorPadding: "standard",
  paragraphSpacing: "standard",
  firstLineIndent: "none",
  theme: "light",
  ruledPaper: false,
  ruledPaperIntensity: "soft"
};
