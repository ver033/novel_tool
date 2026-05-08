import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { chapterSaveContentInputSchema } from "../../src/main/shared/schemas";
import { readTxtFile } from "../../src/main/import/txt-reader";

const rootDir = process.cwd();

function readSource(file: string): string {
  return readFileSync(join(rootDir, file), "utf8");
}

describe("review hardening regressions", () => {
  it("applies Electron fuses and blocks renderer-created navigation surfaces", () => {
    const forge = readSource("forge.config.ts");
    const main = readSource("src/main/index.ts");
    const rendererHtml = readSource("src/renderer/index.html");

    expect(forge).toContain("flipFuses");
    expect(forge).toContain("FuseV1Options.RunAsNode");
    expect(forge).toContain("EnableNodeOptionsEnvironmentVariable");
    expect(forge).toContain("EnableNodeCliInspectArguments");
    expect(main).toContain("setWindowOpenHandler");
    expect(main).toContain("will-navigate");
    expect(main).toContain("Content-Security-Policy");
    expect(main).toContain("createRendererContentSecurityPolicy");
    expect(main).toContain("\"script-src 'self' 'unsafe-inline'\"");
    expect(main).toContain("\"script-src 'self'\"");
    expect(rendererHtml).not.toContain("Content-Security-Policy");
  });

  it("only accepts renderer file paths selected through trusted main-process dialogs", () => {
    const importIpc = readSource("src/main/ipc/import-ipc.ts");
    const projectIpc = readSource("src/main/ipc/project-ipc.ts");

    expect(importIpc).toContain("allowSelectedTxtFilePath");
    expect(importIpc).toContain("assertSelectedTxtFilePathAllowed");
    expect(projectIpc).toContain("allowSelectedProjectFilePath");
    expect(projectIpc).toContain("assertSelectedProjectFilePathAllowed");
  });

  it("sanitizes IPC validation failures before Electron serializes them", () => {
    const ipc = readSource("src/main/ipc/register-ipc.ts");

    expect(ipc).toContain("sanitizeIpcError");
    expect(ipc).toContain("IpcPayloadValidationError");
    expect(ipc).toContain("IPC 请求参数无效。");
  });

  it("sanitizes direct IPC handlers that do not need payload validation", () => {
    const registerIpc = readSource("src/main/ipc/register-ipc.ts");
    const importIpc = readSource("src/main/ipc/import-ipc.ts");
    const projectIpc = readSource("src/main/ipc/project-ipc.ts");
    const settingsIpc = readSource("src/main/ipc/settings-ipc.ts");

    expect(registerIpc).toContain("createIpcHandler");
    expect(registerIpc).toMatch(/ipcChannels\.system\.getDatabaseStatus[\s\S]*createIpcHandler/);
    expect(importIpc).toMatch(/ipcChannels\.import\.selectTxtFile[\s\S]*createIpcHandler/);
    expect(projectIpc).toMatch(/ipcChannels\.project\.selectProjectFile[\s\S]*createIpcHandler/);
    expect(projectIpc).toMatch(/ipcChannels\.project\.getCurrentProject[\s\S]*createIpcHandler/);
    expect(projectIpc).toMatch(/ipcChannels\.project\.listRecentProjects[\s\S]*createIpcHandler/);
    expect(settingsIpc).toMatch(/ipcChannels\.settings\.get[\s\S]*createIpcHandler/);
  });

  it("bounds chapter content payload size at the IPC schema layer", () => {
    const oversizedPlainText = "字".repeat(1_000_001);

    expect(
      chapterSaveContentInputSchema.safeParse({
        chapterId: "chapter_1",
        contentJson: {
          type: "doc",
          content: []
        },
        plainText: oversizedPlainText
      }).success
    ).toBe(false);
  });

  it("accepts a client chapter version for stale-save protection", () => {
    expect(
      chapterSaveContentInputSchema.safeParse({
        chapterId: "chapter_1",
        contentJson: {
          type: "doc",
          content: []
        },
        plainText: "正文",
        expectedUpdatedAt: "2026-05-04T00:00:00.000Z"
      }).success
    ).toBe(true);
  });

  it("rejects oversized TXT imports before reading the whole file", () => {
    const dir = mkdtempSync(join(tmpdir(), "novel-tool-large-txt-"));
    const filePath = join(dir, "large.txt");
    writeFileSync(filePath, Buffer.alloc(21 * 1024 * 1024, "a"));

    expect(existsSync(filePath)).toBe(true);
    expect(() => readTxtFile(filePath)).toThrow("TXT 文件过大");
  });

  it("keeps underline provided by StarterKit and resets selection submenu state", () => {
    const editor = readSource("src/renderer/editor/NovelEditor.tsx");
    const bubbleMenu = readSource("src/renderer/editor/SelectionBubbleMenu.tsx");

    expect(editor).toContain("StarterKit.configure");
    expect(editor).not.toContain("@tiptap/extension-underline");
    expect(bubbleMenu).toContain("selectionUpdate");
  });

  it("gives modals dialog semantics and keyboard dismissal", () => {
    const modal = readSource("src/renderer/components/Modal.tsx");

    expect(modal).toContain('role="dialog"');
    expect(modal).toContain("aria-modal");
    expect(modal).toContain("Escape");
    expect(modal).toContain("onClose");
  });

  it("does not advertise unsupported import drag-drop or hardcode split line 2", () => {
    const importFileStep = readSource("src/renderer/import/ImportFileStep.tsx");
    const importWizard = readSource("src/renderer/routes/ImportWizardPage.tsx");
    const importPreview = readSource("src/renderer/import/ImportPreviewStep.tsx");

    expect(importFileStep).not.toContain("拖入 TXT 文件");
    expect(importWizard).not.toContain("lineNumber: 2");
    expect(importPreview).toContain("activeChapterIndex");
  });
});
