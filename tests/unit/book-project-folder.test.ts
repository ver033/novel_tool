import { describe, expect, it } from "vitest";
import { isBookFilePath, isPathInsideProjectBookFolder, isProjectBookFolderPath, normalizeProjectFolderName } from "../../src/main/external-book-sync/book-project-folder";

describe("project book folder matching", () => {
  it("matches only whole folder segments", () => {
    expect(isPathInsideProjectBookFolder("D:\\写作\\举足无措\\story.Book", "举足无措", "win32")).toBe(true);
    expect(isPathInsideProjectBookFolder("D:\\写作\\举足无措资料\\story.Book", "举足无措", "win32")).toBe(false);
    expect(isPathInsideProjectBookFolder("D:\\写作\\别的项目\\story.Book", "举足无措", "win32")).toBe(false);
  });

  it("handles direct project folder selection", () => {
    expect(isProjectBookFolderPath("D:\\写作\\举足无措", "举足无措", "win32")).toBe(true);
    expect(isProjectBookFolderPath("D:\\写作\\举足无措资料", "举足无措", "win32")).toBe(false);
  });

  it("normalizes project folder names", () => {
    expect(normalizeProjectFolderName("  举足无措  ")).toBe("举足无措");
    expect(normalizeProjectFolderName("举:足?无措")).toBe("举足无措");
  });

  it("matches case-insensitively on Windows", () => {
    expect(isPathInsideProjectBookFolder("D:\\Books\\TestNovel\\story.Book", "testnovel", "win32")).toBe(true);
  });

  it("normalizes parent directory traversal before matching project folder segments", () => {
    expect(isPathInsideProjectBookFolder("D:\\写作\\举足无措\\..\\别的项目\\story.Book", "举足无措", "win32")).toBe(false);
    expect(isPathInsideProjectBookFolder("/Users/me/举足无措/../别的项目/story.Book", "举足无措", "darwin")).toBe(false);
  });

  it("checks .Book extension by basename", () => {
    expect(isBookFilePath("D:\\Books\\举足无措\\story.Book")).toBe(true);
    expect(isBookFilePath("D:\\Books\\举足无措\\story.book")).toBe(true);
    expect(isBookFilePath("D:\\Books\\举足无措\\story.txt")).toBe(false);
  });
});
