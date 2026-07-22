import type { RelationshipGraphSourceStatus, RelationshipGraphStats } from "../../main/shared/relationship-graph";
import type { AppLocale } from "../../main/shared/language";
import { useI18n } from "../i18n";
import { useLocalizedCopy } from "../i18n/localized-copy";

type RelationshipGraphStatusBarProps = {
  readonly status: RelationshipGraphSourceStatus | null;
  readonly stats: RelationshipGraphStats | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onOpenSettings: () => void;
};

function statusText(status: RelationshipGraphSourceStatus | null, loading: boolean, error: string | null, locale: AppLocale, copy: {
  readonly failed: string;
  readonly loading: string;
  readonly noStatus: string;
  readonly ready: string;
}): string {
  if (error) {
    return `${copy.failed}：${error}`;
  }
  if (loading && !status) {
    return copy.loading;
  }
  if (!status) {
    return copy.noStatus;
  }
  return locale === "ja-JP" ? copy.ready : status.message;
}

export function RelationshipGraphStatusBar({ status, stats, loading, error, onOpenSettings }: RelationshipGraphStatusBarProps) {
  const { locale } = useI18n();
  const copy = useLocalizedCopy({
    "zh-CN": { failed: "读取失败", loading: "正在读取人物关系图", noStatus: "还没有读取图谱来源状态", ready: "图谱来源已就绪", visible: "当前显示", chapters: "章，使用", evidence: "条关系证据", settings: "缓存设置" },
    "ja-JP": { failed: "読み込み失敗", loading: "人物関係図を読み込んでいます", noStatus: "関係図の取得元を確認しています", ready: "関係図の取得元を確認しました", visible: "現在", chapters: "章を表示、", evidence: "件の関係根拠を使用", settings: "キャッシュ設定" }
  });
  return (
    <div className="relationship-status-bar" aria-live="polite">
      <span>{statusText(status, loading, error, locale, copy)}</span>
      {stats ? (
        <span>
          {copy.visible} {stats.visibleChapterCount} {copy.chapters} {stats.usedMentionCount}/{stats.totalMentionCount} {copy.evidence}
        </span>
      ) : null}
      <button onClick={onOpenSettings} type="button">
        {copy.settings}
      </button>
    </div>
  );
}
