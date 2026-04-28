import { memo, useEffect, useRef, type CSSProperties } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Link from "@tiptap/extension-link";
import { BackgroundColor, FontSize, TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { UniqueID } from "@tiptap/extension-unique-id";
import { countWritingUnits } from "../../main/shared/text";
import type { EditorSettings, SelectionSnapshot, TaskPromptPreset, TaskType } from "../../main/shared/types";
import { SelectionBubbleMenu } from "./SelectionBubbleMenu";
import type { TiptapDocument } from "./tiptap/converters";
import { createParagraphId, ensureParagraphIds } from "./tiptap/paragraph-id";
import { TextAlignExtension } from "./tiptap/text-align";

export type NovelEditorProps = {
  readonly chapterId: string | null;
  readonly contentJson: TiptapDocument;
  readonly contentVersion: number;
  readonly editorSettings: EditorSettings;
  readonly taskPromptPresets: readonly TaskPromptPreset[];
  readonly onContentChange: (contentJson: TiptapDocument) => void;
  readonly onEditorReady?: (editor: Editor | null) => void;
  readonly onSelectionToScratchpad?: (snapshot: SelectionSnapshot) => Promise<void> | void;
  readonly onTask: (task: TaskType, snapshot?: SelectionSnapshot | null, preset?: TaskPromptPreset | null) => void;
};

type EditorContentStyle = CSSProperties & {
  readonly "--editor-font-family": string;
  readonly "--editor-font-size": string;
  readonly "--editor-line-height": string;
  readonly "--editor-paragraph-spacing": string;
  readonly "--editor-first-line-indent": string;
};

const fontFamilyBySetting = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  song: "'Songti SC', 'STSong', 'SimSun', serif",
  hei: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  fangsong: "'FangSong', 'STFangsong', 'FangSong_GB2312', serif"
} as const;

const paragraphSpacingBySetting = {
  compact: "18px",
  standard: "25px",
  loose: "34px"
} as const;

const firstLineIndentBySetting = {
  none: "0",
  two: "2em",
  four: "4em"
} as const;

export const NovelEditor = memo(function NovelEditor({
  chapterId,
  contentJson,
  contentVersion,
  editorSettings,
  taskPromptPresets,
  onContentChange,
  onEditorReady,
  onSelectionToScratchpad,
  onTask
}: NovelEditorProps) {
  const appliedContentVersion = useRef<number | null>(null);
  const editorContentStyle: EditorContentStyle = {
    "--editor-font-family": fontFamilyBySetting[editorSettings.fontFamily] ?? fontFamilyBySetting.system,
    "--editor-font-size": `${editorSettings.fontSize}px`,
    "--editor-line-height": String(editorSettings.lineHeight),
    "--editor-paragraph-spacing": paragraphSpacingBySetting[editorSettings.paragraphSpacing] ?? paragraphSpacingBySetting.standard,
    "--editor-first-line-indent": firstLineIndentBySetting[editorSettings.firstLineIndent] ?? firstLineIndentBySetting.two
  };
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
        link: false
      }),
      Link.configure({
        autolink: false,
        linkOnPaste: false,
        openOnClick: false,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: null
        }
      }),
      TextStyle,
      FontSize,
      BackgroundColor,
      TextAlignExtension,
      Placeholder.configure({
        placeholder: "开始写正文...",
        showOnlyCurrent: false
      }),
      CharacterCount.configure({
        textCounter: countWritingUnits,
        wordCounter: countWritingUnits
      }),
      UniqueID.configure({
        attributeName: "paragraphId",
        types: ["paragraph", "heading"],
        generateID: createParagraphId
      })
    ],
    content: ensureParagraphIds(contentJson),
    editorProps: {
      attributes: {
        class: "tiptap-manuscript"
      }
    },
    onUpdate({ editor: currentEditor }) {
      onContentChange(currentEditor.getJSON() as TiptapDocument);
    }
  });

  useEffect(() => {
    if (!editor || appliedContentVersion.current === contentVersion) {
      return;
    }

    editor.commands.setContent(ensureParagraphIds(contentJson), { emitUpdate: false });
    appliedContentVersion.current = contentVersion;
  }, [chapterId, contentJson, contentVersion, editor]);

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  function handleTask(task: TaskType, snapshot: SelectionSnapshot, taskPromptPreset?: TaskPromptPreset | null): void {
    onTask(task, snapshot, taskPromptPreset);
  }

  return (
    <>
      {editor ? (
        <SelectionBubbleMenu
          chapterId={chapterId}
          editor={editor}
          taskPromptPresets={taskPromptPresets}
          onSelectionToScratchpad={onSelectionToScratchpad}
          onTask={handleTask}
        />
      ) : null}
      <EditorContent editor={editor} className="novel-editor-content" style={editorContentStyle} />
    </>
  );
});
