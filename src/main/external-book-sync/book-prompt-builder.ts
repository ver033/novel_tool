import type { ExternalBookMissingChapter, ExternalBookReferenceChapter } from "./book-chapter-compare";

const EXTERNAL_BOOK_SYNC_CHAPTER_SPLIT_THRESHOLD = 20_000;
const EMPTY_EXTERNAL_BOOK_CHAPTER_TEXT = "（本章 .Book 正文为空）";

export type BuildExternalBookSyncChatMessagesInput = {
  readonly projectName: string;
  readonly currentLatestLabel: string;
  readonly latestProjectChapterInExternal?: ExternalBookReferenceChapter | null;
  readonly missingChapters: readonly ExternalBookMissingChapter[];
};

function splitLongText(text: string): string[] {
  if (text.length <= EXTERNAL_BOOK_SYNC_CHAPTER_SPLIT_THRESHOLD) {
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
    if (paragraph.length > EXTERNAL_BOOK_SYNC_CHAPTER_SPLIT_THRESHOLD) {
      pushCurrent();
      for (let index = 0; index < paragraph.length; index += EXTERNAL_BOOK_SYNC_CHAPTER_SPLIT_THRESHOLD) {
        chunks.push(paragraph.slice(index, index + EXTERNAL_BOOK_SYNC_CHAPTER_SPLIT_THRESHOLD));
      }
      continue;
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > EXTERNAL_BOOK_SYNC_CHAPTER_SPLIT_THRESHOLD) {
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
  const sendingLabel = input.latestProjectChapterInExternal
    ? `当前项目最新章对应 .Book 内容：${input.latestProjectChapterInExternal.title}`
    : input.missingChapters.length > 0
      ? `缺失章节：${chapterRangeLabel}`
      : "无";
  return [
    "【外部写作软件同步检查】",
    "",
    input.missingChapters.length > 0 ? "下面是从外部 .Book 文件中检测到、但当前墨枢项目还没有的章节。" : null,
    input.latestProjectChapterInExternal ? "附上当前项目最新章在 .Book 中的对应正文，用来判断项目内最新章是否落后于外部文件。" : null,
    "请先阅读这些内容，等待作者下一步指令。不要自动改写、不要总结成缓存、不要假设这些章节已经写入项目。",
    "",
    `当前项目：${input.projectName}`,
    `当前项目最新章节（项目内，仅作比较基准）：${input.currentLatestLabel}`,
    `本条发送章节：${sendingLabel}`,
    `本批缺失章节：${chapterRangeLabel}`,
    `消息分段：${partLabel}`,
    ""
  ].filter((line): line is string => line !== null).join("\n");
}

function buildSectionMessages(input: BuildExternalBookSyncChatMessagesInput, title: string, text: string): string[] {
  const body = text.trim() ? text : EMPTY_EXTERNAL_BOOK_CHAPTER_TEXT;
  const chunks = splitLongText(body);
  return chunks.map((chunk, index) => {
    const suffix = chunks.length > 1 ? `（${index + 1}/${chunks.length}）` : "";
    return `${buildHeader(input, `${index + 1}/${chunks.length}`)}${title}${suffix}\n${chunk}`.trim();
  });
}

export function buildExternalBookSyncChatMessages(input: BuildExternalBookSyncChatMessagesInput): string[] {
  const latestSection = input.latestProjectChapterInExternal
    ? buildSectionMessages(
        {
          ...input,
          missingChapters: []
        },
        `## 当前项目最新章在 .Book 中的对应内容：${input.latestProjectChapterInExternal.title}`,
        input.latestProjectChapterInExternal.projectChapterTitle === input.latestProjectChapterInExternal.title
          ? input.latestProjectChapterInExternal.text
          : `项目章节标题：${input.latestProjectChapterInExternal.projectChapterTitle}\n\n${input.latestProjectChapterInExternal.text}`
      )
    : [];
  const missingSections = input.missingChapters.flatMap((chapter) =>
    buildSectionMessages(
      {
        ...input,
        latestProjectChapterInExternal: null,
        missingChapters: [chapter]
      },
      `## 缺失章节：${chapter.title}`,
      chapter.text
    )
  );
  const messages = [...latestSection, ...missingSections];
  return messages.length > 0 ? messages : [buildHeader(input, "1/1").trim()];
}
