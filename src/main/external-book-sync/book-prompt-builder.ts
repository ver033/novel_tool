import type { ExternalBookMissingChapter, ExternalBookReferenceChapter } from "./book-chapter-compare";

const MAX_EXTERNAL_BOOK_SYNC_MESSAGE_CHARS = 7000;

export type BuildExternalBookSyncChatMessagesInput = {
  readonly projectName: string;
  readonly currentLatestLabel: string;
  readonly latestProjectChapterInExternal?: ExternalBookReferenceChapter | null;
  readonly missingChapters: readonly ExternalBookMissingChapter[];
};

function splitLongText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const paragraphs = text.split(/\n{2,}/u);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) {
      chunks.push(current.trim());
    }
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxLength) {
      pushCurrent();
      for (let index = 0; index < paragraph.length; index += maxLength) {
        chunks.push(paragraph.slice(index, index + maxLength));
      }
      continue;
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxLength) {
      pushCurrent();
      current = paragraph;
    } else {
      current = next;
    }
  }
  pushCurrent();
  return chunks;
}

function buildHeader(input: BuildExternalBookSyncChatMessagesInput, partLabel: string): string {
  const chapterRangeLabel =
    input.missingChapters.length === 0
      ? "无"
      : input.missingChapters.length === 1
        ? input.missingChapters[0].title
        : `${input.missingChapters[0]?.title ?? "未知"} - ${input.missingChapters.at(-1)?.title ?? "未知"}`;
  return [
    "【外部写作软件同步检查】",
    "",
    input.missingChapters.length > 0 ? "下面是从外部 .Book 文件中检测到、但当前墨枢项目还没有的章节。" : null,
    input.latestProjectChapterInExternal ? "附上当前项目最新章在 .Book 中的对应正文，用来判断项目内最新章是否落后于外部文件。" : null,
    "请先阅读这些内容，等待作者下一步指令。不要自动改写、不要总结成缓存、不要假设这些章节已经写入项目。",
    "",
    `当前项目：${input.projectName}`,
    `当前项目最新章节：${input.currentLatestLabel}`,
    `本批缺失章节：${chapterRangeLabel}`,
    `消息分段：${partLabel}`,
    ""
  ].filter((line): line is string => line !== null).join("\n");
}

function buildSectionChunks(input: BuildExternalBookSyncChatMessagesInput, title: string, text: string): string[] {
  const available = Math.max(500, MAX_EXTERNAL_BOOK_SYNC_MESSAGE_CHARS - buildHeader(input, "999/999").length - title.length - 8);
  return splitLongText(text, available).map((chunk, index, chunks) => {
    const suffix = chunks.length > 1 ? `（${index + 1}/${chunks.length}）` : "";
    return `${title}${suffix}\n${chunk}`;
  });
}

export function buildExternalBookSyncChatMessages(input: BuildExternalBookSyncChatMessagesInput): string[] {
  const latestSection = input.latestProjectChapterInExternal
    ? buildSectionChunks(
        input,
        `## 当前项目最新章在 .Book 中的对应内容：${input.latestProjectChapterInExternal.title}`,
        input.latestProjectChapterInExternal.projectChapterTitle === input.latestProjectChapterInExternal.title
          ? input.latestProjectChapterInExternal.text
          : `项目章节标题：${input.latestProjectChapterInExternal.projectChapterTitle}\n\n${input.latestProjectChapterInExternal.text}`
      )
    : [];
  const missingSections = input.missingChapters.flatMap((chapter) => buildSectionChunks(input, `## 缺失章节：${chapter.title}`, chapter.text));
  const rawSections = [...latestSection, ...missingSections];

  const messages: string[] = [];
  const placeholderHeader = buildHeader(input, "999/999");
  const maxBodyLength = MAX_EXTERNAL_BOOK_SYNC_MESSAGE_CHARS - placeholderHeader.length;
  let currentSections: string[] = [];
  let currentLength = 0;

  const flush = () => {
    if (currentSections.length > 0) {
      messages.push(currentSections.join("\n\n"));
      currentSections = [];
      currentLength = 0;
    }
  };

  for (const section of rawSections) {
    const nextLength = currentLength + (currentSections.length > 0 ? 2 : 0) + section.length;
    if (currentSections.length > 0 && nextLength > maxBodyLength) {
      flush();
    }
    currentSections.push(section);
    currentLength += (currentSections.length > 1 ? 2 : 0) + section.length;
  }
  flush();

  const total = Math.max(messages.length, 1);
  const finalMessages = messages.map((body, index) => `${buildHeader(input, `${index + 1}/${total}`)}${body}`.trim());
  return finalMessages.length > 0 ? finalMessages : [buildHeader(input, "1/1").trim()];
}
