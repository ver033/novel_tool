const cjkCharacterPattern = /\p{Script=Han}/gu;
const latinWordPattern = /[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g;

export function countWritingUnits(text: string): number {
  const cjkMatches = text.match(cjkCharacterPattern) ?? [];
  const textWithoutCjk = text.replace(cjkCharacterPattern, " ");
  const latinMatches = textWithoutCjk.match(latinWordPattern) ?? [];

  return cjkMatches.length + latinMatches.length;
}
