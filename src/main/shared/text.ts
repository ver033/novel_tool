function isHanWritingCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x3005 ||
    codePoint === 0x3007 ||
    codePoint === 0x303b ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3ffff)
  );
}

function isLatinAlphanumericCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x30 && codePoint <= 0x39) ||
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a) ||
    (codePoint >= 0xff10 && codePoint <= 0xff19) ||
    (codePoint >= 0xff21 && codePoint <= 0xff3a) ||
    (codePoint >= 0xff41 && codePoint <= 0xff5a)
  );
}

export function countWritingUnits(text: string): number {
  let count = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    if (isHanWritingCodePoint(codePoint) || isLatinAlphanumericCodePoint(codePoint)) {
      count += 1;
    }
  }

  return count;
}
