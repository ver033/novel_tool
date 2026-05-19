import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanBookFiles } from "../../src/main/external-book-sync/filesystem-book-scanner";
import { searchWindowsIndexForBookFiles } from "../../src/main/external-book-sync/windows-index-search";

const tempDirs: string[] = [];
const rootDir = process.cwd();

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("scanBookFiles", () => {
  it("uses an indexed queue so broad scans avoid repeated array shifts", () => {
    const source = readFileSync(join(rootDir, "src/main/external-book-sync/filesystem-book-scanner.ts"), "utf8");

    expect(source).not.toContain("queue.shift()");
  });

  it("finds .Book files only under the project-name folder without entering excluded directories", async () => {
    const root = mkdtempSync(join(tmpdir(), "book-scan-"));
    tempDirs.push(root);
    mkdirSync(join(root, "举足无措"), { recursive: true });
    mkdirSync(join(root, "别的项目"), { recursive: true });
    mkdirSync(join(root, "node_modules"), { recursive: true });
    writeFileSync(join(root, "举足无措", "story.Book"), "第一章\n正文", "utf8");
    writeFileSync(join(root, "别的项目", "ignored.Book"), "第一章\n不应读取", "utf8");
    writeFileSync(join(root, "node_modules", "ignored.Book"), "第一章\n不应读取", "utf8");

    const result = await scanBookFiles({
      projectName: "举足无措",
      roots: [root],
      timeBudgetMs: 10_000,
      signal: new AbortController().signal,
      onProgress: () => undefined
    });

    expect(result.files.map((file) => file.path.endsWith("story.Book"))).toEqual([true]);
    expect(result.files.some((file) => file.path.includes("别的项目"))).toBe(false);
    expect(result.files.some((file) => file.path.includes("node_modules"))).toBe(false);
  });

  it("does not return or read non-.Book files", async () => {
    const root = mkdtempSync(join(tmpdir(), "book-scan-"));
    tempDirs.push(root);
    mkdirSync(join(root, "story"), { recursive: true });
    writeFileSync(join(root, "story", "story.txt"), "第一章\n正文", "utf8");
    writeFileSync(join(root, "story.Book"), "第一章\n正文", "utf8");

    const result = await scanBookFiles({
      projectName: "story",
      roots: [root],
      timeBudgetMs: 10_000,
      signal: new AbortController().signal,
      onProgress: () => undefined
    });

    expect(result.files).toEqual([]);
  });

  it("marks scans as cancelled", async () => {
    const root = mkdtempSync(join(tmpdir(), "book-scan-"));
    tempDirs.push(root);
    const controller = new AbortController();
    controller.abort();

    const result = await scanBookFiles({
      projectName: "story",
      roots: [root],
      timeBudgetMs: 10_000,
      signal: controller.signal
    });

    expect(result.cancelled).toBe(true);
  });
});

describe("searchWindowsIndexForBookFiles", () => {
  it("uses the Windows Search index provider instead of a recursive PowerShell file walk", () => {
    const source = readFileSync(join(rootDir, "src/main/external-book-sync/windows-index-search.ts"), "utf8");

    expect(source).toContain("Search.CollatorDSO");
    expect(source).toContain("SYSTEMINDEX");
    expect(source).not.toContain("Get-ChildItem -Path");
  });

  it.runIf(process.platform !== "win32")("returns unsupported on non-Windows", async () => {
    await expect(searchWindowsIndexForBookFiles({ projectName: "举足无措", timeoutMs: 15_000 })).resolves.toEqual({
      status: "unsupported",
      files: []
    });
  });
});
