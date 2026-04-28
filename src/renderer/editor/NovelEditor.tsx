import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Link from "@tiptap/extension-link";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { UniqueID } from "@tiptap/extension-unique-id";
import { countWritingUnits } from "../../main/shared/text";
import type { EditorSettings, SelectionSnapshot, TaskType } from "../../main/shared/types";
import { EditorToolbar } from "./EditorToolbar";
import { SelectionBubbleMenu } from "./SelectionBubbleMenu";
import type { TiptapDocument } from "./tiptap/converters";
import { createParagraphId, ensureParagraphIds } from "./tiptap/paragraph-id";

export type NovelEditorProps = {
  readonly chapterId: string | null;
  readonly contentJson: TiptapDocument;
  readonly contentVersion: number;
  readonly editorSettings: EditorSettings;
  readonly onContentChange: (contentJson: TiptapDocument) => void;
  readonly onEditorReady?: (editor: Editor | null) => void;
  readonly onEditorSettingsChange: (patch: Partial<EditorSettings>) => void;
  readonly onTask: (task: TaskType, snapshot?: SelectionSnapshot | null) => void;
};

type EditorContentStyle = CSSProperties & {
  readonly "--editor-font-size": string;
  readonly "--editor-line-height": string;
};

export const NovelEditor = memo(function NovelEditor({
  chapterId,
  contentJson,
  contentVersion,
  editorSettings,
  onContentChange,
  onEditorReady,
  onEditorSettingsChange,
  onTask
}: NovelEditorProps) {
  const appliedContentVersion = useRef<number | null>(null);
  const [showGlobalToolbar, setShowGlobalToolbar] = useState(false);
  const editorContentStyle: EditorContentStyle = {
    "--editor-font-size": `${editorSettings.fontSize}px`,
    "--editor-line-height": String(editorSettings.lineHeight)
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

  function handleTask(task: TaskType, snapshot: SelectionSnapshot): void {
    onTask(task, snapshot);
  }

  return (
    <>
      <button
        className="editor-global-style-toggle"
        type="button"
        aria-expanded={showGlobalToolbar}
        onClick={() => setShowGlobalToolbar((current) => !current)}
      >
        Aa 全局样式
      </button>
      {showGlobalToolbar ? <EditorToolbar editorSettings={editorSettings} onEditorSettingsChange={onEditorSettingsChange} /> : null}
      {editor ? <SelectionBubbleMenu chapterId={chapterId} editor={editor} onTask={handleTask} /> : null}
      <EditorContent editor={editor} className="novel-editor-content" style={editorContentStyle} />
    </>
  );
});
