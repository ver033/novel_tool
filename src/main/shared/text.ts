const cjkCharacterPattern = /\p{Script=Han}/gu;
const latinAlphanumericPattern = /[A-Za-z0-9]/g;

export function countWritingUnits(text: string): number {
  const cjkMatches = text.match(cjkCharacterPattern) ?? [];
  const textWithoutCjk = text.replace(cjkCharacterPattern, " ");
  const latinMatches = textWithoutCjk.match(latinAlphanumericPattern) ?? [];

  return cjkMatches.length + latinMatches.length;
}
