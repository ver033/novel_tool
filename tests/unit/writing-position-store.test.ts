import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getLastWritingPosition,
  resolveInitialActiveChapterId,
  saveLastWritingPosition
} from "../../src/renderer/state/writing-position-store";
import type { ChapterSummary } from "../../src/main/shared/types";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function chapter(id: string, sortOrder: number): ChapterSummary {
  return {
    id,
    projectId: "project_1",
    title: id,
    volumeTitle: "第一卷",
    sortOrder,
    wordCount: 0,
    dailyWordCount: 0,
    dailyWordCountDate: null,
    targetWordCount: null,
    status: "draft",
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z"
  };
}

describe("writing position store", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage()
    });
  });

  afterEach(() => {
    if (originalLocalStorageDescriptor) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorageDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("persists the last active chapter per project", () => {
    saveLastWritingPosition({ projectId: "project_1", chapterId: "chapter_2" });
    saveLastWritingPosition({ projectId: "project_2", chapterId: "chapter_9" });

    expect(getLastWritingPosition("project_1")).toMatchObject({ chapterId: "chapter_2" });
    expect(getLastWritingPosition("project_2")).toMatchObject({ chapterId: "chapter_9" });
  });

  it("restores an existing last active chapter before falling back to the first chapter", () => {
    const chapters = [chapter("chapter_1", 0), chapter("chapter_2", 1)];
    saveLastWritingPosition({ projectId: "project_1", chapterId: "chapter_2" });

    expect(resolveInitialActiveChapterId("project_1", chapters)).toBe("chapter_2");
    expect(resolveInitialActiveChapterId("project_2", chapters)).toBe("chapter_1");
  });

  it("ignores stale saved chapter ids that are no longer in the project", () => {
    const chapters = [chapter("chapter_1", 0), chapter("chapter_2", 1)];
    saveLastWritingPosition({ projectId: "project_1", chapterId: "deleted_chapter" });

    expect(resolveInitialActiveChapterId("project_1", chapters)).toBe("chapter_1");
  });
});
