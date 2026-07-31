import {
  createCipheriv,
  createDecipheriv,
  pbkdf2,
  pbkdf2Sync,
  randomBytes
} from "node:crypto";

export const EXTERNAL_BOOK_SYNC_ENCRYPTION_PASSPHRASE = "tongbu";
export const EXTERNAL_BOOK_SYNC_ENCRYPTION_FORMAT = "moshu.external-book-sync.aes-gcm";
export const EXTERNAL_BOOK_SYNC_ENCRYPTION_VERSION = 1;
export const EXTERNAL_BOOK_SYNC_ENCRYPTION_PREFIX = "MOSHU-AES1.";

// Copy-safe wire format:
// MOSHU-AES1.<iterations>.<salt_b64url>.<iv_b64url>.<auth_tag_b64url>.<ciphertext_b64url>
// The token itself never contains whitespace or JSON escape characters. A decryptor may
// therefore receive either the token alone or the complete pretty-printed provider input.
const AES_ALGORITHM = "aes-256-gcm";
const AES_KEY_BYTES = 32;
const AES_IV_BYTES = 12;
const AES_AUTH_TAG_BYTES = 16;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_DIGEST = "sha256";
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const COMPACT_TOKEN_PATTERN = /MOSHU-AES1\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/gu;
const COMPACT_TOKEN_EXACT_PATTERN = /^MOSHU-AES1\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/u;

export type ExternalBookSyncEncryptedEnvelope = {
  readonly format: typeof EXTERNAL_BOOK_SYNC_ENCRYPTION_FORMAT;
  readonly version: typeof EXTERNAL_BOOK_SYNC_ENCRYPTION_VERSION;
  readonly encoding: "utf-8";
  readonly cipher: "AES-256-GCM";
  readonly kdf: "PBKDF2-HMAC-SHA256";
  readonly iterations: typeof PBKDF2_ITERATIONS;
  readonly salt: string;
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: string;
};

function assertPassphrase(passphrase: string): void {
  if (!passphrase) {
    throw new Error("外部 .Book 同步加密密钥不能为空。");
  }
}

function deriveEncryptionKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2(
      passphrase,
      salt,
      PBKDF2_ITERATIONS,
      AES_KEY_BYTES,
      PBKDF2_DIGEST,
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(key);
      }
    );
  });
}

function buildCompactHeader(iterations: number, salt: string, iv: string): Buffer {
  return Buffer.from(
    `${EXTERNAL_BOOK_SYNC_ENCRYPTION_PREFIX}${iterations}.${salt}.${iv}`,
    "utf8"
  );
}

function findCompactToken(serialized: string): string | null {
  const trimmed = serialized.trim();
  if (COMPACT_TOKEN_EXACT_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const matches = serialized.match(COMPACT_TOKEN_PATTERN) ?? [];
  if (matches.length > 1) {
    throw new Error("外部 .Book 同步密文包格式无效：内容中包含多个密文，请只复制一个 content。");
  }
  return matches[0] ?? null;
}

function decodeBase64UrlField(
  value: string,
  fieldName: string,
  expectedBytes?: number,
  allowEmpty = false
): Buffer {
  if ((!value && !allowEmpty) || (value && !BASE64URL_PATTERN.test(value))) {
    throw new Error(`外部 .Book 同步密文包格式无效：${fieldName} 不是规范 Base64URL。`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error(`外部 .Book 同步密文包格式无效：${fieldName} 不是规范 Base64URL。`);
  }
  if (expectedBytes !== undefined && decoded.length !== expectedBytes) {
    throw new Error(`外部 .Book 同步密文包格式无效：${fieldName} 长度错误。`);
  }
  return decoded;
}

function parseCompactPacket(token: string): {
  readonly header: Buffer;
  readonly iterations: number;
  readonly salt: Buffer;
  readonly iv: Buffer;
  readonly authTag: Buffer;
  readonly ciphertext: Buffer;
} {
  const [prefix, iterationsText, saltText, ivText, authTagText, ciphertextText, ...extra] = token.split(".");
  if (prefix !== "MOSHU-AES1" || extra.length > 0) {
    throw new Error("外部 .Book 同步密文包格式无效：算法或版本不受支持。");
  }
  const iterations = Number.parseInt(iterationsText, 10);
  if (String(iterations) !== iterationsText || iterations !== PBKDF2_ITERATIONS) {
    throw new Error("外部 .Book 同步密文包格式无效：KDF 参数不受支持。");
  }
  return {
    header: buildCompactHeader(iterations, saltText, ivText),
    iterations,
    salt: decodeBase64UrlField(saltText, "salt", PBKDF2_SALT_BYTES),
    iv: decodeBase64UrlField(ivText, "iv", AES_IV_BYTES),
    authTag: decodeBase64UrlField(authTagText, "authTag", AES_AUTH_TAG_BYTES),
    ciphertext: decodeBase64UrlField(ciphertextText, "ciphertext", undefined, true)
  };
}

function decodeBase64Field(value: unknown, fieldName: string, expectedBytes?: number): Buffer {
  if (
    typeof value !== "string" ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  ) {
    throw new Error(`外部 .Book 同步密文包格式无效：${fieldName} 不是标准 Base64。`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error(`外部 .Book 同步密文包格式无效：${fieldName} 不是规范 Base64。`);
  }
  if (expectedBytes !== undefined && decoded.length !== expectedBytes) {
    throw new Error(`外部 .Book 同步密文包格式无效：${fieldName} 长度错误。`);
  }
  return decoded;
}

function parseEnvelope(serialized: string): {
  readonly envelope: ExternalBookSyncEncryptedEnvelope;
  readonly salt: Buffer;
  readonly iv: Buffer;
  readonly authTag: Buffer;
  readonly ciphertext: Buffer;
} {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("外部 .Book 同步密文包格式无效：不是合法 JSON。");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("外部 .Book 同步密文包格式无效：根节点必须是对象。");
  }
  const envelope = value as Partial<ExternalBookSyncEncryptedEnvelope>;
  if (
    envelope.format !== EXTERNAL_BOOK_SYNC_ENCRYPTION_FORMAT ||
    envelope.version !== EXTERNAL_BOOK_SYNC_ENCRYPTION_VERSION ||
    envelope.encoding !== "utf-8" ||
    envelope.cipher !== "AES-256-GCM" ||
    envelope.kdf !== "PBKDF2-HMAC-SHA256" ||
    envelope.iterations !== PBKDF2_ITERATIONS
  ) {
    throw new Error("外部 .Book 同步密文包格式无效：算法或版本不受支持。");
  }
  return {
    envelope: envelope as ExternalBookSyncEncryptedEnvelope,
    salt: decodeBase64Field(envelope.salt, "salt", PBKDF2_SALT_BYTES),
    iv: decodeBase64Field(envelope.iv, "iv", AES_IV_BYTES),
    authTag: decodeBase64Field(envelope.authTag, "authTag", AES_AUTH_TAG_BYTES),
    ciphertext: decodeBase64Field(envelope.ciphertext, "ciphertext")
  };
}

export async function encryptExternalBookSyncMessage(
  plaintext: string,
  passphrase = EXTERNAL_BOOK_SYNC_ENCRYPTION_PASSPHRASE
): Promise<string> {
  assertPassphrase(passphrase);
  const salt = randomBytes(PBKDF2_SALT_BYTES);
  const iv = randomBytes(AES_IV_BYTES);
  const key = await deriveEncryptionKey(passphrase, salt);
  const saltText = salt.toString("base64url");
  const ivText = iv.toString("base64url");
  const header = buildCompactHeader(PBKDF2_ITERATIONS, saltText, ivText);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv, {
    authTagLength: AES_AUTH_TAG_BYTES
  });
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);
  return [
    "MOSHU-AES1",
    String(PBKDF2_ITERATIONS),
    saltText,
    ivText,
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

export function decryptExternalBookSyncMessage(
  serialized: string,
  passphrase = EXTERNAL_BOOK_SYNC_ENCRYPTION_PASSPHRASE
): string {
  assertPassphrase(passphrase);
  const compactToken = findCompactToken(serialized);
  const parsed = compactToken
    ? parseCompactPacket(compactToken)
    : parseEnvelope(serialized);
  const key = pbkdf2Sync(
    passphrase,
    parsed.salt,
    "iterations" in parsed ? parsed.iterations : parsed.envelope.iterations,
    AES_KEY_BYTES,
    PBKDF2_DIGEST
  );
  try {
    const decipher = createDecipheriv(AES_ALGORITHM, key, parsed.iv, {
      authTagLength: AES_AUTH_TAG_BYTES
    });
    if ("header" in parsed) {
      decipher.setAAD(parsed.header);
    }
    decipher.setAuthTag(parsed.authTag);
    return Buffer.concat([
      decipher.update(parsed.ciphertext),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new Error("外部 .Book 同步密文无法解密：密钥错误或密文已损坏。");
  }
}
