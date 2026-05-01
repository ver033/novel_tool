import { describe, expect, it } from "vitest";
import { getVisibleDailyWordCount } from "../../src/renderer/state/editor-store";

describe("editor daily word count display", () => {
  it("keeps pending daily word count visible while autosave is saving", () => {
    expect(
      getVisibleDailyWordCount({
        dailyWordCount: 0,
        dailyWordCountDate: "2026-04-29",
        savedWordCount: 10,
        saveStatus: "saving",
        today: "2026-04-29",
        wordCount: 16
      })
    ).toBe(6);
  });

  it("reduces pending daily word count when the current edit deletes or undoes text", () => {
    expect(
      getVisibleDailyWordCount({
        dailyWordCount: 8,
        dailyWordCountDate: "2026-04-29",
        savedWordCount: 20,
        saveStatus: "dirty",
        today: "2026-04-29",
        wordCount: 16
      })
    ).toBe(4);
  });

  it("shows zero when a chapter is opened on a new day before editing", () => {
    expect(
      getVisibleDailyWordCount({
        dailyWordCount: 1200,
        dailyWordCountDate: "2026-04-28",
        savedWordCount: 3000,
        saveStatus: "saved",
        today: "2026-04-29",
        wordCount: 3000
      })
    ).toBe(0);
  });

  it("starts new-day pending count from zero after editing", () => {
    expect(
      getVisibleDailyWordCount({
        dailyWordCount: 1200,
        dailyWordCountDate: "2026-04-28",
        savedWordCount: 3000,
        saveStatus: "dirty",
        today: "2026-04-29",
        wordCount: 3024
      })
    ).toBe(24);
  });
});
