export const emptyChapterContent = Object.freeze({
  type: "doc",
  content: [
    {
      type: "paragraph"
    }
  ]
});

export function serializeContentJson(contentJson: unknown): string {
  return JSON.stringify(contentJson);
}

export function parseContentJson(contentJson: string): unknown {
  return JSON.parse(contentJson) as unknown;
}
