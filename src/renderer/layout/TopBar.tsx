import { BookOpen, GearSix, MagnifyingGlass, UploadSimple } from "@phosphor-icons/react";
import { IconButton } from "../components/IconButton";

type TopBarProps = {
  readonly title: string;
  readonly subtitle?: string;
  readonly mode?: "welcome" | "writing";
  readonly saveStatus?: "saved" | "dirty" | "saving" | "failed";
  readonly onImport?: () => void;
  readonly onWelcome: () => void;
  readonly onSettings: () => void;
};

function saveStatusLabel(status: NonNullable<TopBarProps["saveStatus"]>): string {
  if (status === "dirty") {
    return "编辑中";
  }
  if (status === "saving") {
    return "保存中";
  }
  if (status === "failed") {
    return "保存失败";
  }
  return "已自动保存";
}

export function TopBar({ title, subtitle, mode = "writing", saveStatus = "saved", onImport, onWelcome, onSettings }: TopBarProps) {
  return (
    <header className="topbar">
      <button className="brand brand-button" onClick={onWelcome} title="返回开始页" type="button">
        <span className={mode === "welcome" ? "logo" : "line-icon"}>
          <BookOpen size={24} weight="regular" />
        </span>
        <span>
          {title}
          {subtitle ? <small>{subtitle}</small> : null}
        </span>
      </button>
      <label className="search">
        <MagnifyingGlass size={21} />
        <input placeholder={mode === "welcome" ? "搜索作品或章节" : "搜索章节或内容"} />
      </label>
      <div className="top-actions">
        {mode === "writing" && onImport ? (
          <IconButton label="导入 TXT" onClick={() => onImport()}>
            <UploadSimple size={24} weight="regular" />
          </IconButton>
        ) : null}
        <IconButton label="设置" onClick={onSettings}>
          <GearSix size={24} weight="regular" />
        </IconButton>
        {mode === "writing" ? (
          <span className={`status-pill ${saveStatus}`}>
            <span className="dot" />
            {saveStatusLabel(saveStatus)}
          </span>
        ) : null}
      </div>
    </header>
  );
}
