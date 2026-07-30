import { memo, useEffect, useRef, type CSSProperties } from "react";
import { Extension } from "@tiptap/core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Link from "@tiptap/extension-link";
import { BackgroundColor, FontSize, TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { UniqueID } from "@tiptap/extension-unique-id";
import { countWritingUnits } from "../../main/shared/text";
import type { EditorSettings, SelectionSnapshot, TaskPromptPreset, TaskType } from "../../main/shared/types";
import { SelectionBubbleMenu } from "./SelectionBubbleMenu";
import { useI18n } from "../i18n";
import type { TiptapDocument } from "./tiptap/converters";
import { createParagraphId, ensureParagraphIds } from "./tiptap/paragraph-id";
import { TextAlignExtension } from "./tiptap/text-align";

export type NovelEditorProps = {
  readonly chapterId: string | null;
  readonly contentJson: TiptapDocument;
  readonly contentVersion: number;
  readonly editorSettings: EditorSettings;
  readonly lockedSelectionSnapshot?: SelectionSnapshot | null;
  readonly searchTarget?: EditorSearchTarget | null;
  readonly taskPromptPresets: readonly TaskPromptPreset[];
  readonly onContentChange: (contentJson: TiptapDocument) => void;
  readonly onEditorReady?: (editor: Editor | null) => void;
  readonly onSearchTargetResolved?: (targetId: number) => void;
  readonly onSelectionToChat?: (snapshot: SelectionSnapshot) => void;
  readonly onSelectionToScratchpad?: (snapshot: SelectionSnapshot) => Promise<void> | void;
  readonly onTask: (task: TaskType, snapshot?: SelectionSnapshot | null, preset?: TaskPromptPreset | null) => void;
};

export type EditorSearchTarget = {
  readonly chapterId: string;
  readonly id: number;
  readonly paragraphId: string | null;
  readonly paragraphIndex: number | null;
  readonly query: string;
};

type EditorContentStyle = CSSProperties & {
  readonly "--editor-font-family": string;
  readonly "--editor-font-size": string;
  readonly "--editor-line-height": string;
  readonly "--editor-line-step": string;
  readonly "--editor-paragraph-spacing": string;
  readonly "--editor-first-line-indent": string;
};

const fontFamilyBySetting = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  song: "'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif JP', 'Noto Serif CJK JP', 'Songti SC', 'STSong', 'SimSun', serif",
  hei: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  fangsong: "'FangSong', 'STFangsong', 'FangSong_GB2312', serif",
  kai: "'Kaiti SC', 'STKaiti', 'KaiTi', serif"
} as const;

const paragraphSpacingBySetting = {
  compact: "0px",
  standard: "var(--editor-line-step)",
  loose: "calc(var(--editor-line-step) * 2)"
} as const;

const firstLineIndentBySetting = {
  none: "0",
  two: "2em",
  four: "4em"
} as const;

const searchJumpHighlightPluginKey = new PluginKey<DecorationSet>("moshuSearchJumpHighlight");
const aiTaskLockedSelectionPluginKey = new PluginKey<DecorationSet>("moshuAiTaskLockedSelection");

const SearchJumpHighlightExtension = Extension.create({
  name: "moshuSearchJumpHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: searchJumpHighlightPluginKey,
        props: {
          decorations(state) {
            return searchJumpHighlightPluginKey.getState(state);
          }
        },
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(transaction, previousDecorations) {
            const highlightRange = transaction.getMeta(searchJumpHighlightPluginKey) as { readonly from: number; readonly to: number } | null | undefined;
            if (highlightRange === null) {
              return DecorationSet.empty;
            }
            if (highlightRange) {
              return DecorationSet.create(transaction.doc, [
                Decoration.inline(highlightRange.from, highlightRange.to, {
                  class: "search-jump-highlight"
                })
              ]);
            }
            return previousDecorations.map(transaction.mapping, transaction.doc);
          }
        }
      })
    ];
  }
});

const AiTaskLockedSelectionExtension = Extension.create({
  name: "moshuAiTaskLockedSelection",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: aiTaskLockedSelectionPluginKey,
        props: {
          decorations(state) {
            return aiTaskLockedSelectionPluginKey.getState(state);
          }
        },
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(transaction, previousDecorations) {
            const lockedRange = transaction.getMeta(aiTaskLockedSelectionPluginKey) as { readonly from: number; readonly to: number } | null | undefined;
            if (lockedRange === null) {
              return DecorationSet.empty;
            }
            if (lockedRange && lockedRange.to > lockedRange.from && lockedRange.to <= transaction.doc.content.size) {
              return DecorationSet.create(transaction.doc, [
                Decoration.inline(lockedRange.from, lockedRange.to, {
                  class: "ai-task-locked-selection",
                  "data-ai-task-selection": "locked"
                })
              ]);
            }
            return previousDecorations.map(transaction.mapping, transaction.doc);
          }
        }
      })
    ];
  }
});

function replaceEditorContentWithoutUndo(editor: Editor, contentJson: TiptapDocument): void {
  const document = editor.schema.nodeFromJSON(ensureParagraphIds(contentJson));
  const transaction = editor.state.tr
    .replaceWith(0, editor.state.doc.content.size, document)
    .setMeta("preventUpdate", true)
    .setMeta("addToHistory", false);

  closeHistory(transaction);
  editor.view.dispatch(transaction);
}

function resolveSearchTargetRange(editor: Editor, target: EditorSearchTarget): { readonly from: number; readonly to: number } | null {
  const query = target.query.trim();
  const lowerQuery = query.toLocaleLowerCase("zh-CN");
  let textBlockIndex = -1;
  let range: { from: number; to: number } | null = null;

  editor.state.doc.descendants((node, position) => {
    if (!node.isTextblock) {
      return true;
    }

    textBlockIndex += 1;
    const nodeParagraphId = typeof node.attrs.paragraphId === "string" ? node.attrs.paragraphId : null;
    const isTargetBlock = target.paragraphId ? nodeParagraphId === target.paragraphId : target.paragraphIndex === textBlockIndex;
    if (!isTargetBlock) {
      return true;
    }

    const matchIndex = lowerQuery ? node.textContent.toLocaleLowerCase("zh-CN").indexOf(lowerQuery) : -1;
    const from = position + 1 + Math.max(0, matchIndex);
    range = {
      from,
      to: matchIndex >= 0 ? from + query.length : from
    };
    return false;
  });

  return range;
}

function scrollSearchRangeIntoEditorView(editor: Editor, position: number): void {
  window.requestAnimationFrame(() => {
    const scrollContainer = editor.view.dom.closest(".editor-scroll");
    if (!(scrollContainer instanceof HTMLElement)) {
      editor.commands.scrollIntoView();
      return;
    }

    const coordinates = editor.view.coordsAtPos(position);
    const containerRect = scrollContainer.getBoundingClientRect();
    const targetTop = scrollContainer.scrollTop + coordinates.top - containerRect.top - 96;
    scrollContainer.scrollTo({
      behavior: "smooth",
      top: Math.max(0, targetTop)
    });
  });
}

export const NovelEditor = memo(function NovelEditor({
  chapterId,
  contentJson,
  contentVersion,
  editorSettings,
  lockedSelectionSnapshot,
  searchTarget,
  taskPromptPresets,
  onContentChange,
  onEditorReady,
  onSearchTargetResolved,
  onSelectionToChat,
  onSelectionToScratchpad,
  onTask
}: NovelEditorProps) {
  const { locale } = useI18n();
  const appliedContentVersion = useRef<number | null>(contentVersion);
  const onContentChangeRef = useRef(onContentChange);
  useEffect(() => {
    onContentChangeRef.current = onContentChange;
  }, [onContentChange]);
  const editorContentStyle: EditorContentStyle = {
    "--editor-font-family": fontFamilyBySetting[editorSettings.fontFamily] ?? fontFamilyBySetting.system,
    "--editor-font-size": `${editorSettings.fontSize}px`,
    "--editor-line-height": String(editorSettings.lineHeight),
    "--editor-line-step": `${editorSettings.fontSize * editorSettings.lineHeight}px`,
    "--editor-paragraph-spacing": paragraphSpacingBySetting[editorSettings.paragraphSpacing] ?? paragraphSpacingBySetting.standard,
    "--editor-first-line-indent": firstLineIndentBySetting[editorSettings.firstLineIndent] ?? firstLineIndentBySetting.two
  };
  const ruledPaperClass = editorSettings.ruledPaper && editorSettings.ruledPaperIntensity !== "off"
    ? `ruled-paper ruled-paper-${editorSettings.ruledPaperIntensity}`
    : "";
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
        placeholder: locale === "ja-JP" ? "本文を書き始める…" : "开始写正文...",
        showOnlyCurrent: false
      }),
      CharacterCount.configure({
        textCounter: countWritingUnits,
        wordCounter: countWritingUnits
      }),
      SearchJumpHighlightExtension,
      AiTaskLockedSelectionExtension,
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
      onContentChangeRef.current(currentEditor.getJSON() as TiptapDocument);
    }
  });

  useEffect(() => {
    if (!editor || appliedContentVersion.current === contentVersion) {
      return;
    }

    replaceEditorContentWithoutUndo(editor, contentJson);
    appliedContentVersion.current = contentVersion;
  }, [contentJson, contentVersion, editor]);

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const lockedRange =
      lockedSelectionSnapshot
      && lockedSelectionSnapshot.chapterId === chapterId
      && lockedSelectionSnapshot.to > lockedSelectionSnapshot.from
      && lockedSelectionSnapshot.to <= editor.state.doc.content.size
        ? { from: lockedSelectionSnapshot.from, to: lockedSelectionSnapshot.to }
        : null;
    editor.view.dispatch(
      editor.state.tr
        .setMeta(aiTaskLockedSelectionPluginKey, lockedRange)
        .setMeta("addToHistory", false)
    );
  }, [chapterId, editor, lockedSelectionSnapshot?.from, lockedSelectionSnapshot?.selectionHash, lockedSelectionSnapshot?.to]);

  useEffect(() => {
    if (!editor || !searchTarget || searchTarget.chapterId !== chapterId) {
      return;
    }

    const range = resolveSearchTargetRange(editor, searchTarget);
    if (!range) {
      return;
    }

    const transaction = editor.state.tr
      .setSelection(TextSelection.create(editor.state.doc, range.from, range.to))
      .setMeta(searchJumpHighlightPluginKey, range.to > range.from ? range : null)
      .scrollIntoView();
    editor.view.dispatch(transaction);
    editor.view.focus();
    scrollSearchRangeIntoEditorView(editor, range.from);
    onSearchTargetResolved?.(searchTarget.id);
  }, [chapterId, contentVersion, editor, onSearchTargetResolved, searchTarget]);

  function handleTask(task: TaskType, snapshot: SelectionSnapshot, taskPromptPreset?: TaskPromptPreset | null): void {
    onTask(task, snapshot, taskPromptPreset);
  }

  return (
    <>
      {editor && !lockedSelectionSnapshot ? (
        <SelectionBubbleMenu
          chapterId={chapterId}
          editor={editor}
          taskPromptPresets={taskPromptPresets}
          onSelectionToChat={onSelectionToChat}
          onSelectionToScratchpad={onSelectionToScratchpad}
          onTask={handleTask}
        />
      ) : null}
      <EditorContent editor={editor} className={`novel-editor-content ${ruledPaperClass}`} style={editorContentStyle} />
    </>
  );
});
