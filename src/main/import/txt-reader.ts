import { readFileSync, statSync } from "node:fs";
import chardet from "chardet";
import iconv from "iconv-lite";
import { normalizeTxtContent } from "./chapter-detector";

const MAX_TXT_IMPORT_BYTES = 20 * 1024 * 1024;

export type TxtReadResult = {
  readonly text: string;
  readonly encoding: string;
};

export type TextReadOptions = {
  readonly label?: string;
  readonly maxBytes?: number;
  readonly encoding?: string;
};

function normalizeEncoding(value: string | null | undefined): string {
  if (!value) {
    return "utf8";
  }
  const normalized = value.toLowerCase().replace(/[_-]/g, "");
  if (normalized === "utf8" || normalized === "ascii") {
    return "utf8";
  }
  if (normalized === "gb18030" || normalized === "gb2312" || normalized === "gbk") {
    return "gb18030";
  }
  if (normalized === "big5") {
    return "big5";
  }
  if (normalized === "shiftjis" || normalized === "sjis" || normalized === "cp932" || normalized === "windows31j") {
    return "shift_jis";
  }
  if (normalized === "eucjp") {
    return "euc-jp";
  }
  return value;
}

export function readTextFile(filePath: string, options: TextReadOptions = {}): TxtReadResult {
  const label = options.label ?? "文本文件";
  const maxBytes = options.maxBytes ?? MAX_TXT_IMPORT_BYTES;
  const stats = statSync(filePath);
  if (stats.size > maxBytes) {
    throw new Error(`${label}过大，请选择 ${Math.floor(maxBytes / 1024 / 1024)}MB 以内的文本文件。`);
  }

  const buffer = readFileSync(filePath);
  const requestedEncoding = options.encoding && options.encoding !== "auto" ? options.encoding : null;
  const encoding = normalizeEncoding(requestedEncoding ?? chardet.detect(buffer));
  if (!iconv.encodingExists(encoding)) {
    throw new Error(`${label}编码不受支持：${encoding}`);
  }
  const text = normalizeTxtContent(iconv.decode(buffer, encoding));

  return {
    text,
    encoding
  };
}

export function readTxtFile(filePath: string, options: Pick<TextReadOptions, "encoding"> = {}): TxtReadResult {
  return readTextFile(filePath, { label: "TXT 文件", maxBytes: MAX_TXT_IMPORT_BYTES, ...options });
}
