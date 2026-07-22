import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import {
  CaretDown,
  ChatCircleText,
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
import type { SelectionSnapshot, TaskPromptPreset, TaskType } from "../../main/shared/types";
import { createSelectionFloatingAnchor, EDITOR_BOTTOM_CHROME_SAFE_AREA, FLOATING_MENU_EDGE_PADDING, shouldOpenDropdownAbove } from "../layout/floating-menu-position";
import { createSelectionSnapshotFromEditor } from "./tiptap/selection-utils";
import type { TextAlignValue } from "./tiptap/text-align";
import { useI18n } from "../i18n";

type EditorInstance = NonNullable<ReturnType<typeof useEditor>>;

type SelectionBubbleMenuProps = {
  readonly chapterId: string | null;
  readonly editor: EditorInstance;
  readonly taskPromptPresets: readonly TaskPromptPreset[];
  readonly onSelectionToChat?: (snapshot: SelectionSnapshot) => void;
  readonly onSelectionToScratchpad?: (snapshot: SelectionSnapshot) => Promise<void> | void;
  readonly onTask: (task: TaskType, snapshot: SelectionSnapshot, preset?: TaskPromptPreset | null) => void;
};

type ActiveMenu = "ai" | "block" | "align" | "highlight" | "more" | null;
type DropdownSide = "bottom" | "top";

const aiTaskTypes: readonly TaskType[] = ["polish", "expand", "proofread", "continue"];

const fontSizeOptions = ["14px", "16px", "18px", "20px"] as const;

const blockOptions = [
  { label: "段落", jaLabel: "段落", icon: <TextT size={19} />, active: "paragraph" as const },
  { label: "标题 1", jaLabel: "見出し 1", icon: <TextHOne size={19} />, active: "heading1" as const },
  { label: "标题 2", jaLabel: "見出し 2", icon: <TextHTwo size={19} />, active: "heading2" as const }
] as const;

const alignOptions: readonly { label: string; jaLabel: string; value: TextAlignValue; icon: ReactNode }[] = [
  { label: "左对齐", jaLabel: "左揃え", value: "left", icon: <TextAlignLeft size={19} /> },
  { label: "居中", jaLabel: "中央揃え", value: "center", icon: <TextAlignCenter size={19} /> },
  { label: "右对齐", jaLabel: "右揃え", value: "right", icon: <TextAlignRight size={19} /> },
  { label: "两端对齐", jaLabel: "両端揃え", value: "justify", icon: <TextAlignJustify size={19} /> }
];

const highlightOptions = [
  { label: "淡黄标注", jaLabel: "黄色のマーカー", value: "#fff2a8" },
  { label: "蓝色标注", jaLabel: "青色のマーカー", value: "#dbeafe" },
  { label: "绿色标注", jaLabel: "緑色のマーカー", value: "#dcfce7" }
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

export function SelectionBubbleMenu({ chapterId, editor, taskPromptPresets, onSelectionToChat, onSelectionToScratchpad, onTask }: SelectionBubbleMenuProps) {
  const { locale, t } = useI18n();
  const japanese = locale === "ja-JP";
  const aiTaskLabels: Record<TaskType, string> = japanese
    ? { polish: "推敲", expand: "加筆", proofread: "校正", continue: "続きを書く" }
    : { polish: "润色", expand: "扩写", proofread: "校对", continue: "续写" };
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const [dropdownSide, setDropdownSide] = useState<DropdownSide>("bottom");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [scratchStatus, setScratchStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [scratchError, setScratchError] = useState("");
  const dropdownOpen = activeMenu !== null || linkOpen || scratchStatus !== "idle";

  const updateDropdownSide = useCallback(() => {
    const menuElement = menuRef.current;
    const dropdownElement = menuElement?.querySelector<HTMLElement>(".bubble-dropdown, .link-editor-popover");
    if (!menuElement || !dropdownElement) {
      setDropdownSide("bottom");
      return;
    }

    setDropdownSide(shouldOpenDropdownAbove(menuElement.getBoundingClientRect(), dropdownElement.getBoundingClientRect().height) ? "top" : "bottom");
  }, []);

  useLayoutEffect(() => {
    if (!dropdownOpen) {
      setDropdownSide("bottom");
      return undefined;
    }

    const frame = window.requestAnimationFrame(updateDropdownSide);
    return () => window.cancelAnimationFrame(frame);
  }, [dropdownOpen, updateDropdownSide]);

  useEffect(() => {
    if (!dropdownOpen) {
      return undefined;
    }

    window.addEventListener("resize", updateDropdownSide);
    window.addEventListener("scroll", updateDropdownSide, true);
    return () => {
      window.removeEventListener("resize", updateDropdownSide);
      window.removeEventListener("scroll", updateDropdownSide, true);
    };
  }, [dropdownOpen, updateDropdownSide]);

  useEffect(() => {
    const resetMenus = () => {
      setActiveMenu(null);
      setLinkOpen(false);
      setScratchStatus("idle");
      setScratchError("");
    };

    editor.on("selectionUpdate", resetMenus);
    return () => {
      editor.off("selectionUpdate", resetMenus);
    };
  }, [editor]);

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
    onTask(task, snapshot, null);
  }

  function runAiPreset(taskPromptPreset: TaskPromptPreset): void {
    const snapshot = createSelectionSnapshotFromEditor(editor, chapterId);
    if (!snapshot) {
      return;
    }

    setActiveMenu(null);
    onTask(taskPromptPreset.taskType, snapshot, taskPromptPreset);
  }

  function sendSelectionToChat(): void {
    const snapshot = createSelectionSnapshotFromEditor(editor, chapterId);
    if (!snapshot || !onSelectionToChat) {
      return;
    }

    setActiveMenu(null);
    onSelectionToChat(snapshot);
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
      setScratchError(japanese ? "現在のプロジェクトを利用できないため、下書きメモへ追加できません。" : "当前项目不可用，无法加入草稿纸。");
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
      const message = reason instanceof Error ? reason.message : japanese ? "下書きメモへの追加に失敗しました。" : "加入草稿纸失败。";
      setScratchStatus("error");
      setScratchError(message);
    }
  }

  const blockActiveLabel = editor.isActive("heading", { level: 1 }) ? (japanese ? "見出し 1" : "标题 1") : editor.isActive("heading", { level: 2 }) ? (japanese ? "見出し 2" : "标题 2") : (japanese ? "段落" : "段落");
  const currentFontSize = (editor.getAttributes("textStyle").fontSize as string | undefined) ?? "16px";
  const visibleTaskPromptPresets = useMemo(
    () => taskPromptPresets.filter((preset) => preset.showInSelectionMenu),
    [taskPromptPresets]
  );

  return (
    <BubbleMenu
      ref={menuRef}
      className="bubble-menu tiptap-bubble-menu selection-bubble-menu"
      data-dropdown-side={dropdownSide}
      editor={editor}
      appendTo={() => document.body}
      getReferencedVirtualElement={() => createSelectionFloatingAnchor(editor)}
      options={{
        strategy: "fixed",
        placement: "top",
        offset: 12,
        flip: { padding: { bottom: EDITOR_BOTTOM_CHROME_SAFE_AREA, left: FLOATING_MENU_EDGE_PADDING, right: FLOATING_MENU_EDGE_PADDING, top: FLOATING_MENU_EDGE_PADDING } },
        shift: { padding: { bottom: EDITOR_BOTTOM_CHROME_SAFE_AREA, left: FLOATING_MENU_EDGE_PADDING, right: FLOATING_MENU_EDGE_PADDING, top: FLOATING_MENU_EDGE_PADDING } },
        inline: true,
        scrollTarget: (editor.view.dom.closest(".editor-scroll") as HTMLElement | null) ?? window
      }}
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
            <button className="send-to-chat-option" onClick={sendSelectionToChat} onMouseDown={keepSelection} type="button">
              <ChatCircleText size={17} />
              <span>{japanese ? "AI チャットへ送る" : "送到 AI Chat"}</span>
            </button>
            <span className="dropdown-label">{japanese ? "執筆操作" : "写作操作"}</span>
            {aiTaskTypes.map((task) => (
              <button key={task} onClick={() => runAiTask(task)} onMouseDown={keepSelection} type="button">
                {aiTaskLabels[task]}
              </button>
            ))}
            {visibleTaskPromptPresets.length > 0 ? (
              <>
                <span className="dropdown-label">{japanese ? "マイプリセット" : "我的预设"}</span>
                {visibleTaskPromptPresets.map((taskPromptPreset) => (
                  <button className="preset-option" key={taskPromptPreset.id} onClick={() => runAiPreset(taskPromptPreset)} onMouseDown={keepSelection} type="button">
                    <span>{taskPromptPreset.name}</span>
                    <small>{aiTaskLabels[taskPromptPreset.taskType]}</small>
                  </button>
                ))}
              </>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="divider" />
      <span className="bubble-segment">
        <button
          aria-label={`${japanese ? "テキストスタイル" : "文本样式"}：${blockActiveLabel}，${currentFontSize}`}
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
                  {japanese ? option.jaLabel : option.label}
                </button>
              ))}
            </span>
            <span className="dropdown-section">
              <span className="dropdown-label">{japanese ? "文字サイズ" : "字号"}</span>
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
          aria-label={japanese ? "段落の配置" : "段落对齐"}
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
                {japanese ? option.jaLabel : option.label}
              </button>
            ))}
          </span>
        ) : null}
      </span>
      <span className="divider" />
      <button className={editor.isActive("bold") ? "active" : ""} onClick={() => editor.chain().focus().toggleBold().run()} onMouseDown={keepSelection} type="button" aria-label={japanese ? "太字" : "加粗"}>
        <TextB size={25} />
      </button>
      <button className={`code-button ${editor.isActive("code") ? "active" : ""}`} onClick={() => editor.chain().focus().toggleCode().run()} onMouseDown={keepSelection} type="button" aria-label={japanese ? "コード" : "代码"}>
        <Code size={23} />
      </button>
      <button className={editor.isActive("italic") ? "active" : ""} onClick={() => editor.chain().focus().toggleItalic().run()} onMouseDown={keepSelection} type="button" aria-label={japanese ? "斜体" : "斜体"}>
        <TextItalic size={25} />
      </button>
      <button className={editor.isActive("link") || linkOpen ? "active" : ""} onClick={openLinkEditor} onMouseDown={keepSelection} type="button" aria-label={japanese ? "リンク" : "链接"}>
        <LinkSimple size={24} />
      </button>
      <button className={editor.isActive("strike") ? "active" : ""} onClick={() => editor.chain().focus().toggleStrike().run()} onMouseDown={keepSelection} type="button" aria-label={japanese ? "取り消し線" : "删除线"}>
        <TextStrikethrough size={25} />
      </button>
      <button className={editor.isActive("underline") ? "active" : ""} onClick={() => editor.chain().focus().toggleUnderline().run()} onMouseDown={keepSelection} type="button" aria-label={japanese ? "下線" : "下划线"}>
        <TextUnderline size={25} />
      </button>
      <span className="divider" />
      <span className="bubble-segment">
        <button
          aria-label={japanese ? "マーカー" : "标注"}
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
                {japanese ? option.jaLabel : option.label}
              </button>
            ))}
            <button onClick={() => runCommand(() => editor.chain().focus().unsetBackgroundColor().run())} onMouseDown={keepSelection} type="button">
              {japanese ? "マーカーを消す" : "清除标注"}
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
          title={scratchError || (japanese ? "選択範囲を下書きメモへ追加" : "把选中文字加入草稿纸")}
          type="button"
          aria-label={japanese ? "下書きメモへ追加" : "加入草稿纸"}
        >
          <NotePencil size={24} />
        </button>
        {scratchStatus !== "idle" ? (
          <span className={`bubble-dropdown note-status ${scratchStatus}`}>
            {scratchStatus === "saving" ? (japanese ? "下書きメモへ追加しています..." : "正在加入草稿纸...") : scratchStatus === "saved" ? (japanese ? "下書きメモへ追加しました" : "已加入草稿纸") : scratchError}
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
          aria-label={japanese ? "その他" : "更多"}
        >
          <DotsThreeVertical size={25} weight="bold" />
        </button>
        {activeMenu === "more" ? (
          <span className="bubble-dropdown more">
            <button onClick={() => runCommand(() => editor.chain().focus().unsetFontSize().run())} onMouseDown={keepSelection} type="button">
              {japanese ? "文字サイズを解除" : "清除字号"}
            </button>
            <button onClick={() => runCommand(() => editor.chain().focus().unsetBackgroundColor().run())} onMouseDown={keepSelection} type="button">
              {japanese ? "マーカーを消す" : "清除标注"}
            </button>
            <button onClick={() => runCommand(() => editor.chain().focus().extendMarkRange("link").unsetLink().run())} onMouseDown={keepSelection} type="button">
              {japanese ? "リンクを解除" : "取消链接"}
            </button>
          </span>
        ) : null}
      </span>
      {linkOpen ? (
        <form className="link-editor-popover" onSubmit={submitLink}>
          <label htmlFor="selection-link-input">{japanese ? "リンク先" : "链接地址"}</label>
          <input
            autoFocus
            id="selection-link-input"
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
            onMouseDown={(event) => event.stopPropagation()}
          />
          <span className="link-editor-actions">
            <button onClick={unsetLink} onMouseDown={keepSelection} type="button">
              {japanese ? "削除" : "移除"}
            </button>
            <button onMouseDown={keepSelection} type="submit">
              {t("save")}
            </button>
          </span>
        </form>
      ) : null}
    </BubbleMenu>
  );
}
