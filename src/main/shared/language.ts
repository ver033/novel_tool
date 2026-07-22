import { z } from "zod";

export const appLocaleSchema = z.enum(["zh-CN", "ja-JP"]);
export const contentLanguageSchema = z.enum(["zh-CN", "ja-JP"]);

export type AppLocale = z.output<typeof appLocaleSchema>;
export type ContentLanguage = z.output<typeof contentLanguageSchema>;

export const DEFAULT_APP_LOCALE: AppLocale = "zh-CN";
export const DEFAULT_CONTENT_LANGUAGE: ContentLanguage = "zh-CN";

export function initialChapterTitle(language: ContentLanguage): string {
  return language === "ja-JP" ? "第1章" : "第1章";
}

export function initialVolumeTitle(language: ContentLanguage): string {
  return language === "ja-JP" ? "第一巻" : "第一卷";
}

/**
 * Resolves the language used to talk to the author for one request.
 * This is intentionally separate from the project's prose language: an author
 * may ask about a Chinese manuscript in Japanese, or vice versa.
 */
export function resolveResponseLanguage(message: string, fallback: ContentLanguage): ContentLanguage {
  if (/(?:日本語\s*(?:で|にして|で回答|で返答)|用日语|日语(?:回答|回复|答复|输出|说明)|翻译成日语|日本語に翻訳)/u.test(message)) {
    return "ja-JP";
  }
  if (/(?:中国語\s*(?:で|にして|で回答|で返答)|用中文|中文(?:回答|回复|答复|输出|说明)|翻译成中文|中国語に翻訳)/u.test(message)) {
    return "zh-CN";
  }

  const kanaCount = message.match(/[\u3040-\u30ff]/gu)?.length ?? 0;
  if (kanaCount >= 1) {
    return "ja-JP";
  }
  return fallback;
}

/**
 * Detects only high-confidence Chinese-first answers for a Japanese request.
 * The check is deliberately asymmetric and conservative: Japanese prose may
 * legitimately quote Chinese manuscript text, while Chinese-first prose tends
 * to contain multiple simplified-Chinese markers and no Japanese grammar.
 */
export function needsJapaneseResponseCorrection(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  if (/(?:です|ます|でした|ません|してください|でしょう|について|として|章では|まとめると|要約すると)/u.test(normalized)) {
    return false;
  }

  const kanaCount = normalized.match(/[\u3040-\u30ff]/gu)?.length ?? 0;
  const simplifiedMarkerCount = normalized.match(/[这们为说请对现还题经进过结论让从与会后里发应当种仅读写]/gu)?.length ?? 0;
  const chinesePhraseCount = normalized.match(/(?:好的|可以|没问题|明白了|当然|下面是|总结如下|主要讲述|用户要求)/gu)?.length ?? 0;
  const confidence = simplifiedMarkerCount + chinesePhraseCount * 3;
  return confidence >= 3 && confidence >= Math.max(3, Math.ceil(kanaCount / 2));
}

export function resolveInlineContentLanguage(text: string, fallback: ContentLanguage): ContentLanguage {
  const normalized = text.trim();
  if (!normalized) return fallback;
  const kanaCount = normalized.match(/[\u3040-\u30ff]/gu)?.length ?? 0;
  const japaneseGrammar = /(?:です|ます|でした|ません|して|った|ない|から|ので|けれど|そして|しかし)/u.test(normalized);
  return kanaCount >= 2 || japaneseGrammar ? "ja-JP" : fallback;
}
