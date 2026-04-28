import type { EditorSettings } from "../../main/shared/types";
import { EditorStyleDropdown } from "./EditorStyleDropdown";

type EditorToolbarProps = {
  readonly editorSettings: EditorSettings;
  readonly onEditorSettingsChange: (patch: Partial<EditorSettings>) => void;
};

const fontSizeOptions = [16, 18, 20, 22, 24, 26] as const;
const lineHeightOptions = [1.7, 1.9, 2.08, 2.2, 2.4] as const;

export function EditorToolbar({ editorSettings, onEditorSettingsChange }: EditorToolbarProps) {
  return (
    <div className="editor-toolbar" aria-label="全局编辑样式">
      <span className="toolbar-label">全局样式</span>
      <span className="divider" />
      <EditorStyleDropdown
        label={`${editorSettings.fontSize}px`}
        options={fontSizeOptions.map((size) => ({
          label: `${size}px`,
          active: editorSettings.fontSize === size,
          onSelect: () => onEditorSettingsChange({ fontSize: size })
        }))}
      />
      <span className="divider" />
      <EditorStyleDropdown
        label={`行高 ${editorSettings.lineHeight}`}
        options={lineHeightOptions.map((lineHeight) => ({
          label: String(lineHeight),
          active: editorSettings.lineHeight === lineHeight,
          onSelect: () => onEditorSettingsChange({ lineHeight })
        }))}
      />
    </div>
  );
}
