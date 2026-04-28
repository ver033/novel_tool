import { useState, type FormEvent, type MouseEvent } from "react";
import type { useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { SelectionSnapshot, TaskType } from "../../main/shared/types";
import { EditorStyleDropdown } from "./EditorStyleDropdown";
import { createSelectionSnapshotFromEditor } from "./tiptap/selection-utils";

type EditorInstance = NonNullable<ReturnType<typeof useEditor>>;

type SelectionBubbleMenuProps = {
  readonly chapterId: string | null;
  readonly editor: EditorInstance;
  readonly onTask: (task: TaskType, snapshot: SelectionSnapshot) => void;
};

const aiTasks: readonly [TaskType, string][] = [
  ["polish", "✧ 润色"],
  ["expand", "↗ 扩写"],
  ["proofread", "✓ 校对"],
  ["continue", "♧ 续写"]
];

function keepSelection(event: MouseEvent): void {
  event.preventDefault();
}

function normalizeHref(value: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return value;
  }
  return `https://${value}`;
}

export function SelectionBubbleMenu({ chapterId, editor, onTask }: SelectionBubbleMenuProps) {
  const [aiOpen, setAiOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");

  function runAiTask(task: TaskType): void {
    const snapshot = createSelectionSnapshotFromEditor(editor, chapterId);
    if (!snapshot) {
      return;
    }

    setAiOpen(false);
    onTask(task, snapshot);
  }

  function openLinkEditor(): void {
    const previousHref = editor.getAttributes("link").href as string | undefined;
    setAiOpen(false);
    setLinkDraft(previousHref ?? "https://");
    setLinkOpen(true);
  }

  function closeLinkEditor(): void {
    setLinkOpen(false);
    setLinkDraft("");
  }

  function submitLink(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmedHref = linkDraft.trim();
    if (!trimmedHref) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      closeLinkEditor();
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href: normalizeHref(trimmedHref) }).run();
    closeLinkEditor();
  }

  function unsetLink(): void {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    closeLinkEditor();
  }

  return (
    <BubbleMenu
      className="bubble-menu tiptap-bubble-menu selection-bubble-menu"
      editor={editor}
      options={{ placement: "top", offset: 10 }}
      shouldShow={({ editor: currentEditor, from, to }) => currentEditor.isEditable && to > from}
    >
      <span className="editor-style-dropdown">
        <button
          className={`tool-button ask-ai-button ${aiOpen ? "active" : ""}`}
          onClick={() => setAiOpen((current) => !current)}
          onMouseDown={keepSelection}
          type="button"
        >
          ✧ Ask AI⌄
        </button>
        {aiOpen ? (
          <span className="style-dropdown-menu ai-task-menu">
            {aiTasks.map(([task, label]) => (
              <button key={task} onClick={() => runAiTask(task)} onMouseDown={keepSelection} type="button">
                {label}
              </button>
            ))}
          </span>
        ) : null}
      </span>
      <span className="divider" />
      <EditorStyleDropdown
        label={editor.isActive("heading", { level: 1 }) ? "标题 1" : editor.isActive("heading", { level: 2 }) ? "标题 2" : "段落"}
        options={[
          { label: "段落", active: editor.isActive("paragraph"), onSelect: () => editor.chain().focus().setParagraph().run() },
          { label: "标题 1", active: editor.isActive("heading", { level: 1 }), onSelect: () => editor.chain().focus().setHeading({ level: 1 }).run() },
          { label: "标题 2", active: editor.isActive("heading", { level: 2 }), onSelect: () => editor.chain().focus().setHeading({ level: 2 }).run() }
        ]}
      />
      <span className="divider" />
      <EditorStyleDropdown
        label={(editor.getAttributes("textStyle").fontSize as string | undefined) ?? "16px"}
        options={["14px", "16px", "18px", "20px"].map((size) => ({
          label: size,
          active: editor.isActive("textStyle", { fontSize: size }),
          onSelect: () => editor.chain().focus().setFontSize(size).run()
        }))}
      />
      <span className="divider" />
      <button className={`tool-button ${editor.isActive("bold") ? "active" : ""}`} onClick={() => editor.chain().focus().toggleBold().run()} onMouseDown={keepSelection} type="button">
        <b>B</b>
      </button>
      <button className={`tool-button ${editor.isActive("italic") ? "active" : ""}`} onClick={() => editor.chain().focus().toggleItalic().run()} onMouseDown={keepSelection} type="button">
        <i>I</i>
      </button>
      <button className={`tool-button ${editor.isActive("underline") ? "active" : ""}`} onClick={() => editor.chain().focus().toggleUnderline().run()} onMouseDown={keepSelection} type="button">
        <u>U</u>
      </button>
      <button className={`tool-button ${editor.isActive("strike") ? "active" : ""}`} onClick={() => editor.chain().focus().toggleStrike().run()} onMouseDown={keepSelection} type="button">
        S
      </button>
      <span className="editor-style-dropdown">
        <button className={`tool-button ${editor.isActive("link") || linkOpen ? "active" : ""}`} onClick={openLinkEditor} onMouseDown={keepSelection} type="button" aria-label="链接">
          链
        </button>
        {linkOpen ? (
          <form className="link-editor-popover" onSubmit={submitLink}>
            <label htmlFor="selection-link-input">链接地址</label>
            <input
              autoFocus
              id="selection-link-input"
              value={linkDraft}
              onChange={(event) => setLinkDraft(event.target.value)}
              onMouseDown={(event) => event.stopPropagation()}
            />
            <span className="link-editor-actions">
              <button onClick={unsetLink} onMouseDown={keepSelection} type="button">
                移除
              </button>
              <button onMouseDown={keepSelection} type="submit">
                保存
              </button>
            </span>
          </form>
        ) : null}
      </span>
      <span className="divider" />
      <button className="tool-button" onMouseDown={keepSelection} type="button">
        •••
      </button>
    </BubbleMenu>
  );
}
