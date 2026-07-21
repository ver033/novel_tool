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
  const encoding = normalizeEncoding(chardet.detect(buffer));
  const text = normalizeTxtContent(iconv.decode(buffer, encoding));

  return {
    text,
    encoding
  };
}

export function readTxtFile(filePath: string): TxtReadResult {
  return readTextFile(filePath, { label: "TXT 文件", maxBytes: MAX_TXT_IMPORT_BYTES });
}
