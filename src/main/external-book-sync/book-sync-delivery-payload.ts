import { createHash } from "node:crypto";
import type { ExternalBookSentChapterKind } from "./book-send-history-store";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function buildExternalBookSyncDeliveryPayload(input: {
  readonly projectId: string;
  readonly kind: ExternalBookSentChapterKind;
  readonly chapterIdentity: string;
  readonly sourceContentHash: string;
  readonly partIndex: number;
  readonly partCount: number;
  readonly message: string;
}): {
  readonly deliveryId: string;
  readonly bodyHash: string;
  readonly plaintextHash: string;
  readonly plaintextMessage: string;
} {
  const bodyHash = sha256(input.message);
  const deliveryIdHash = sha256([
    input.projectId,
    input.kind,
    input.chapterIdentity,
    input.sourceContentHash,
    `${input.partIndex + 1}/${input.partCount}`,
    bodyHash
  ].join("\u0000"));
  const deliveryId = `external_book_delivery_${deliveryIdHash.slice(0, 32)}`;
  const plaintextMessage = [
    "【墨枢外部同步投递】",
    `投递编号：${deliveryId}`,
    `正文 SHA-256：${bodyHash}`,
    `消息分段：${input.partIndex + 1}/${input.partCount}`,
    "",
    input.message
  ].join("\n");
  return {
    deliveryId,
    bodyHash,
    plaintextHash: sha256(plaintextMessage),
    plaintextMessage
  };
}
