import { describe, expect, it } from "vitest";
import { buildExternalBookSyncDeliveryPayload } from "../../src/main/external-book-sync/book-sync-delivery-payload";

describe("buildExternalBookSyncDeliveryPayload", () => {
  it("builds a stable UTF-8 plaintext envelope with an integrity hash", () => {
    const input = {
      projectId: "project_雨夜",
      kind: "missing_chapter" as const,
      chapterIdentity: "ordinal:2",
      sourceContentHash: "source-hash",
      partIndex: 0,
      partCount: 1,
      message: "第二章　雨夜归人\n𠮷野说：“山河無恙🌙。”"
    };

    const first = buildExternalBookSyncDeliveryPayload(input);
    const second = buildExternalBookSyncDeliveryPayload(input);

    expect(first).toEqual(second);
    expect(first.deliveryId).toMatch(/^external_book_delivery_[a-f0-9]{32}$/u);
    expect(first.plaintextMessage).toContain(`投递编号：${first.deliveryId}`);
    expect(first.plaintextMessage).toContain(`正文 SHA-256：${first.bodyHash}`);
    expect(first.plaintextMessage).toContain("第二章　雨夜归人\n𠮷野说：“山河無恙🌙。”");
    expect(first.plaintextHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});
