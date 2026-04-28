import { readFileSync } from "node:fs";
import chardet from "chardet";
import iconv from "iconv-lite";
import { normalizeTxtContent } from "./chapter-detector";

export type TxtReadResult = {
  readonly text: string;
  readonly encoding: string;
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

export function readTxtFile(filePath: string): TxtReadResult {
  const buffer = readFileSync(filePath);
  const encoding = normalizeEncoding(chardet.detect(buffer));
  const text = normalizeTxtContent(iconv.decode(buffer, encoding));

  return {
    text,
    encoding
  };
}
