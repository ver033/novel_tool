import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptExternalBookSyncMessage,
  encryptExternalBookSyncMessage,
  EXTERNAL_BOOK_SYNC_ENCRYPTION_PREFIX,
  EXTERNAL_BOOK_SYNC_ENCRYPTION_PASSPHRASE
} from "../../src/main/external-book-sync/book-sync-crypto";

const CHINESE_NOVEL_TEXT = [
  "《雾隐长街》",
  "第一百二十七章　雨夜归人",
  "",
  "檐角的铜铃“叮——”地响了一声。",
  "𠮷野抬起头，看见巷尾有人撑着一柄旧油纸伞；雨水沿伞骨落下，像一串断开的珠子。",
  "“你终于回来了。”她说。",
  "",
  "换行、全角标点、繁體字與 emoji：山河無恙🌙",
  "路径与转义文本：C:\\小说\\第一章，字面量 \\n 不应变成换行。"
].join("\r\n");

describe("external Book sync AES envelope", () => {
  it("round-trips formatted Chinese novel text as one copy-safe Base64URL token", async () => {
    const encrypted = await encryptExternalBookSyncMessage(
      CHINESE_NOVEL_TEXT,
      EXTERNAL_BOOK_SYNC_ENCRYPTION_PASSPHRASE
    );

    expect(encrypted.startsWith(EXTERNAL_BOOK_SYNC_ENCRYPTION_PREFIX)).toBe(true);
    expect(encrypted).toMatch(/^MOSHU-AES1\.600000\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/u);
    expect(encrypted).not.toMatch(/[\s"'\\+/=]/u);
    expect(encrypted).not.toContain(CHINESE_NOVEL_TEXT);
    expect(encrypted).not.toContain("雨夜归人");
    expect(encrypted).not.toContain(EXTERNAL_BOOK_SYNC_ENCRYPTION_PASSPHRASE);
    expect(
      decryptExternalBookSyncMessage(encrypted, EXTERNAL_BOOK_SYNC_ENCRYPTION_PASSPHRASE)
    ).toBe(CHINESE_NOVEL_TEXT);
  });

  it("uses fresh salt and IV for repeated encryption without changing the decrypted text", async () => {
    const first = await encryptExternalBookSyncMessage(CHINESE_NOVEL_TEXT);
    const second = await encryptExternalBookSyncMessage(CHINESE_NOVEL_TEXT);

    expect(first).not.toBe(second);
    expect(decryptExternalBookSyncMessage(first)).toBe(CHINESE_NOVEL_TEXT);
    expect(decryptExternalBookSyncMessage(second)).toBe(CHINESE_NOVEL_TEXT);
  });

  it("extracts and decrypts one ciphertext from a pretty-printed TokenHub input log", async () => {
    const encrypted = await encryptExternalBookSyncMessage(CHINESE_NOVEL_TEXT);
    const copiedInput = `input:${JSON.stringify({
      model: "deepseek-v4-flash",
      messages: [
        {
          role: "user",
          content: encrypted
        }
      ],
      stream: true,
      max_tokens: 12_000
    }, null, 2)}`;

    expect(copiedInput).toContain("\n");
    expect(decryptExternalBookSyncMessage(copiedInput, "tongbu"))
      .toBe(CHINESE_NOVEL_TEXT);
  });

  it("can be independently decrypted from the documented compact packet", async () => {
    const encrypted = await encryptExternalBookSyncMessage(CHINESE_NOVEL_TEXT);
    const [prefix, iterationsText, saltText, ivText, authTagText, ciphertextText] =
      encrypted.split(".");
    const iterations = Number.parseInt(iterationsText, 10);
    const salt = Buffer.from(saltText, "base64url");
    const iv = Buffer.from(ivText, "base64url");
    const authTag = Buffer.from(authTagText, "base64url");
    const ciphertext = Buffer.from(ciphertextText, "base64url");
    const header = Buffer.from(
      `${prefix}.${iterationsText}.${saltText}.${ivText}`,
      "utf8"
    );

    expect(prefix).toBe("MOSHU-AES1");
    expect(iterations).toBe(600_000);
    const key = pbkdf2Sync(
      "tongbu",
      salt,
      iterations,
      32,
      "sha256"
    );
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      iv,
      { authTagLength: 16 }
    );
    decipher.setAAD(header);
    decipher.setAuthTag(authTag);
    const independentlyDecrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString("utf8");

    expect(independentlyDecrypted).toBe(CHINESE_NOVEL_TEXT);
  });

  it("rejects an incorrect key instead of returning garbled text", async () => {
    const encrypted = await encryptExternalBookSyncMessage(CHINESE_NOVEL_TEXT);

    expect(() => decryptExternalBookSyncMessage(encrypted, "wrong-key"))
      .toThrow("密钥错误或密文已损坏");
  });

  it("rejects tampered ciphertext instead of returning partial or garbled text", async () => {
    const encrypted = await encryptExternalBookSyncMessage(CHINESE_NOVEL_TEXT);
    const fields = encrypted.split(".");
    const ciphertext = Buffer.from(fields[5], "base64url");
    ciphertext[ciphertext.length - 1] = (ciphertext[ciphertext.length - 1] ?? 0) ^ 0xff;
    fields[5] = ciphertext.toString("base64url");
    const tampered = fields.join(".");

    expect(() => decryptExternalBookSyncMessage(tampered))
      .toThrow("密钥错误或密文已损坏");
  });
});
