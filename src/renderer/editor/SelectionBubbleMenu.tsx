import { useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import {
  CaretDown,
  Code,
  DotsThreeVertical,
  Highlighter,
  LinkSimple,
  NotePencil,
  Sparkle,
  TextAlignCenter,
  TextAlignJustify,
  TextAlignLeft,
  TextAlignRight,
  TextB,
  TextHOne,
  TextHTwo,
  TextItalic,
  TextStrikethrough,
  TextT,
  TextUnderline
} from "@phosphor-icons/react";
import type { useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { SelectionSnapshot, TaskType } from "../../main/shared/types";
import { createSelectionSnapshotFromEditor } from "./tiptap/selection-utils";
import type { TextAlignValue } from "./tiptap/text-align";

type EditorInstance = NonNullable<ReturnType<typeof useEditor>>;

type SelectionBubbleMenuProps = {
  readonly chapterId: string | null;
  readonly editor: EditorInstance;
  readonly onSelectionToScratchpad?: (snapshot: SelectionSnapshot) => Promise<void> | void;
  readonly onTask: (task: TaskType, snapshot: SelectionSnapshot) => void;
};

type ActiveMenu = "ai" | "block" | "align" | "highlight" | "more" | null;

const aiTasks: readonly [TaskType, string][] = [
  ["polish", "润色"],
  ["expand", "扩写"],
  ["proofread", "校对"],
  ["continue", "续写"]
];

const fontSizeOptions = ["14px", "16px", "18px", "20px"] as const;

const blockOptions = [
  { label: "段落", icon: <TextT size={19} />, active: "paragraph" as const },
  { label: "标题 1", icon: <TextHOne size={19} />, active: "heading1" as const },
  { label: "标题 2", icon: <TextHTwo size={19} />, active: "heading2" as const }
] as const;

const alignOptions: readonly { label: string; value: TextAlignValue; icon: ReactNode }[] = [
  { label: "左对齐", value: "left", icon: <TextAlignLeft size={19} /> },
  { label: "居中", value: "center", icon: <TextAlignCenter size={19} /> },
  { label: "右对齐", value: "right", icon: <TextAlignRight size={19} /> },
  { label: "两端对齐", value: "justify", icon: <TextAlignJustify size={19} /> }
];

const highlightOptions = [
  { label: "淡黄标注", value: "#fff2a8" },
  { label: "蓝色标注", value: "#dbeafe" },
  { label: "绿色标注", value: "#dcfce7" }
] as const;

function keepSelection(event: MouseEvent): void {
  event.preventDefault();
}

function normalizeHref(value: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return value;
  }
  return `https://${value}`;
}

function isTextAlignActive(editor: EditorInstance, value: TextAlignValue): boolean {
  return editor.isActive("paragraph", { textAlign: value }) || editor.isActive("heading", { textAlign: value });
}

export function SelectionBubbleMenu({ chapterId, editor, onSelectionToScratchpad, onTask }: SelectionBubbleMenuProps) {
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [scratchStatus, setScratchStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [scratchError, setScratchError] = useState("");

  function toggleMenu(menu: Exclude<ActiveMenu, null>): void {
    setLinkOpen(false);
    setScratchStatus("idle");
    setScratchError("");
    setActiveMenu((current) => (current === menu ? null : menu));
  }

  function runAiTask(task: TaskType): void {
    const snapshot = createSelectionSnapshotFromEditor(editor, chapterId);
    if (!snapshot) {
      return;
    }

    setActiveMenu(null);
    onTask(task, snapshot);
  }

  function runCommand(command: () => void): void {
    setActiveMenu(null);
    setLinkOpen(false);
    command();
  }

  function openLinkEditor(): void {
    const previousHref = editor.getAttributes("link").href as string | undefined;
    setActiveMenu(null);
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

  async function saveSelectionToScratchpad(): Promise<void> {
    const snapshot = createSelectionSnapshotFromEditor(editor, chapterId);
    if (!snapshot || !onSelectionToScratchpad) {
      setScratchStatus("error");
      setScratchError("当前项目不可用，无法加入草稿纸。");
      return;
    }

    setActiveMenu(null);
    setLinkOpen(false);
    setScratchStatus("saving");
    setScratchError("");

    try {
      await onSelectionToScratchpad(snapshot);
      setScratchStatus("saved");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "加入草稿纸失败。";
      setScratchStatus("error");
      setScratchError(message);
    }
  }

  const blockActiveLabel = editor.isActive("heading", { level: 1 }) ? "标题 1" : editor.isActive("heading", { level: 2 }) ? "标题 2" : "段落";
  const currentFontSize = (editor.getAttributes("textStyle").fontSize as string | undefined) ?? "16px";

  return (
    <BubbleMenu
      className="bubble-menu tiptap-bubble-menu selection-bubble-menu"
      editor={editor}
      options={{ placement: "top", offset: 12 }}
      shouldShow={({ editor: currentEditor, from, to }) => currentEditor.isEditable && to > from}
    >
      <span className="bubble-segment">
        <button
          className={`ask-ai-button ${activeMenu === "ai" ? "active" : ""}`}
          onClick={() => toggleMenu("ai")}
          onMouseDown={keepSelection}
          type="button"
        >
          <Sparkle size={24} weight="fill" />
          <span>Ask AI</span>
        </button>
        {activeMenu === "ai" ? (
          <span className="bubble-dropdown ai">
            {aiTasks.map(([task, label]) => (
              <button key={task} onClick={() => runAiTask(task)} onMouseDown={keepSelection} type="button">
                {label}
              </button>
            ))}
          </span>
        ) : null}
      </span>
      <span className="divider" />
      <span className="bubble-segment">
        <button
          aria-label={`文本样式：${blockActiveLabel}，${currentFontSize}`}
          className={`select-button icon-select ${activeMenu === "block" ? "active" : ""}`}
          onClick={() => toggleMenu("block")}
          onMouseDown={keepSelection}
          type="button"
        >
          <TextT size={25} />
          <CaretDown className="caret" size={13} />
        </button>
        {activeMenu === "block" ? (
          <span className="bubble-dropdown block">
            <span className="dropdown-section">
              {blockOptions.map((option) => (
                <button
                  className={
                    option.active === "paragraph"
                      ? editor.isActive("paragraph")
                        ? "selected"
                        : ""
                      : option.active === "heading1"
                        ? editor.isActive("heading", { level: 1 })
                          ? "selected"
                          : ""
                        : editor.isActive("heading", { level: 2 })
                          ? "selected"
                          : ""
                  }
                  key={option.label}
                  onClick={() =>
                    runCommand(() => {
                      if (option.active === "paragraph") {
                        editor.chain().focus().setParagraph().run();
                        return;
                      }
                      editor.chain().focus().setHeading({ level: option.active === "heading1" ? 1 : 2 }).run();
                    })
                  }
                  onMouseDown={keepSelection}
                  type="button"
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </span>
            <span className="dropdown-section">
              <span className="dropdown-label">字号</span>
              {fontSizeOptions.map((size) => (
                <button
                  className={editor.isActive("textStyle", { fontSize: size }) ? "selected" : ""}
                  key={size}
                  onClick={() => runCommand(() => editor.chain().focus().setFontSize(size).run())}
                  onMouseDown={keepSelection}
                  type="button"
                >
                  {size}
                </button>
              ))}
            </span>
          </span>
        ) : null}
      </span>
      <span className="divider" />
      <span className="bubble-segment">
        <button
          aria-label="段落对齐"
          className={`select-button icon-select ${activeMenu === "align" ? "active" : ""}`}
          onClick={() => toggleMenu("align")}
          onMouseDown={keepSelection}
          type="button"
        >
          <TextAlignLeft size={24} />
          <CaretDown className="caret" size={13} />
        </button>
        {activeMenu === "align" ? (
          <span className="bubble-dropdown align">
            {alignOptions.map((option) => (
              <button
                className={isTextAlignActive(editor, option.value) ? "selected" : ""}
                key={option.value}
                onClick={() => runCommand(() => editor.chain().focus().setTextAlign(option.value).run())}
                onMouseDown={keepSelection}
                type="button"
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </span>
        ) : null}
      </span>
      <span className="divider" />
      <button className={editor.isActive("bold") ? "active" : ""} onClick={() => editor.chain().focus().toggleBold().run()} onMouseDown={keepSelection} type="button" aria-label="加粗">
        <TextB size={25} />
      </button>
      <button className={`code-button ${editor.isActive("code") ? "active" : ""}`} onClick={() => editor.chain().focus().toggleCode().run()} onMouseDown={keepSelection} type="button" aria-label="代码">
        <Code size={23} />
      </button>
      <button className={editor.isActive("italic") ? "active" : ""} onClick={() => editor.chain().focus().toggleItalic().run()} onMouseDown={keepSelection} type="button" aria-label="斜体">
        <TextItalic size={25} />
      </button>
      <button className={editor.isActive("link") || linkOpen ? "active" : ""} onClick={openLinkEditor} onMouseDown={keepSelection} type="button" aria-label="链接">
        <LinkSimple size={24} />
      </button>
      <button className={editor.isActive("strike") ? "active" : ""} onClick={() => editor.chain().focus().toggleStrike().run()} onMouseDown={keepSelection} type="button" aria-label="删除线">
        <TextStrikethrough size={25} />
      </button>
      <button className={editor.isActive("underline") ? "active" : ""} onClick={() => editor.chain().focus().toggleUnderline().run()} onMouseDown={keepSelection} type="button" aria-label="下划线">
        <TextUnderline size={25} />
      </button>
      <span className="divider" />
      <span className="bubble-segment">
        <button
          aria-label="标注"
          className={activeMenu === "highlight" || Boolean(editor.getAttributes("textStyle").backgroundColor) ? "active" : ""}
          onClick={() => toggleMenu("highlight")}
          onMouseDown={keepSelection}
          type="button"
        >
          <Highlighter size={24} />
          <CaretDown className="caret" size={13} />
        </button>
        {activeMenu === "highlight" ? (
          <span className="bubble-dropdown highlight">
            {highlightOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => runCommand(() => editor.chain().focus().setBackgroundColor(option.value).run())}
                onMouseDown={keepSelection}
                type="button"
              >
                <span className="highlight-swatch" style={{ background: option.value }} />
                {option.label}
              </button>
            ))}
            <button onClick={() => runCommand(() => editor.chain().focus().unsetBackgroundColor().run())} onMouseDown={keepSelection} type="button">
              清除标注
            </button>
          </span>
        ) : null}
      </span>
      <span className="divider" />
      <span className="bubble-segment">
        <button
          className={scratchStatus === "saved" ? "active" : ""}
          onClick={() => void saveSelectionToScratchpad()}
          onMouseDown={keepSelection}
          title={scratchError || "把选中文字加入草稿纸"}
          type="button"
          aria-label="加入草稿纸"
        >
          <NotePencil size={24} />
        </button>
        {scratchStatus !== "idle" ? (
          <span className={`bubble-dropdown note-status ${scratchStatus}`}>
            {scratchStatus === "saving" ? "正在加入草稿纸..." : scratchStatus === "saved" ? "已加入草稿纸" : scratchError}
          </span>
        ) : null}
      </span>
      <span className="divider" />
      <span className="bubble-segment">
        <button
          className={`more-button ${activeMenu === "more" ? "active" : ""}`}
          onClick={() => toggleMenu("more")}
          onMouseDown={keepSelection}
          type="button"
          aria-label="更多"
        >
          <DotsThreeVertical size={25} weight="bold" />
        </button>
        {activeMenu === "more" ? (
          <span className="bubble-dropdown more">
            <button onClick={() => runCommand(() => editor.chain().focus().unsetFontSize().run())} onMouseDown={keepSelection} type="button">
              清除字号
            </button>
            <button onClick={() => runCommand(() => editor.chain().focus().unsetBackgroundColor().run())} onMouseDown={keepSelection} type="button">
              清除标注
            </button>
            <button onClick={() => runCommand(() => editor.chain().focus().extendMarkRange("link").unsetLink().run())} onMouseDown={keepSelection} type="button">
              取消链接
            </button>
          </span>
        ) : null}
      </span>
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
    </BubbleMenu>
  );
}
