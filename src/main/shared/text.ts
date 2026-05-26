const whitespacePattern = /\s/u;

export function countWritingUnits(text: string): number {
  let count = 0;
  for (const character of text) {
    if (!whitespacePattern.test(character)) {
      count += 1;
    }
  }

  return count;
}
