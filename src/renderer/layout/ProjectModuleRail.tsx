import { BookOpen, ChartBar, Files, GearSix, Graph, ListBullets, MagnifyingGlass, Target, Trash } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export type ProjectModule = "writing" | "relationshipGraph" | "outline" | "chapterReview" | "materials" | "goals" | "stats" | "trash" | "settings";

type ProjectModuleItem = {
  readonly id: ProjectModule;
  readonly label: string;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  readonly group?: "main" | "bottom";
  readonly title?: string;
};

type ProjectModuleRailProps = {
  readonly activeModule: ProjectModule;
  readonly onNavigate: (module: ProjectModule) => void;
};

const moduleItems: readonly ProjectModuleItem[] = [
  { id: "writing", label: "正文", icon: <BookOpen size={22} /> },
  { id: "relationshipGraph", label: "人物关系图", icon: <Graph size={22} />, title: "查看人物关系" },
  { id: "outline", label: "大纲", icon: <ListBullets size={22} />, title: "维护全书大纲" },
  { id: "chapterReview", label: "AI审稿", icon: <MagnifyingGlass size={22} />, title: "审阅章节质量" },
  { id: "materials", label: "资料", icon: <Files size={22} />, disabled: true, title: "规划中" },
  { id: "goals", label: "写作目标", icon: <Target size={22} />, title: "查看写作目标" },
  { id: "stats", label: "统计", icon: <ChartBar size={22} />, disabled: true, title: "规划中" },
  { id: "trash", label: "回收站", icon: <Trash size={22} />, disabled: true, title: "规划中" },
  { id: "settings", label: "设置", icon: <GearSix size={22} />, group: "bottom" }
];

function renderModuleButton(item: ProjectModuleItem, activeModule: ProjectModule, onNavigate: (module: ProjectModule) => void) {
  const active = item.id === activeModule;
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`project-module-button ${active ? "active" : ""}`}
      disabled={item.disabled}
      key={item.id}
      onClick={() => onNavigate(item.id)}
      title={item.title ?? item.label}
      type="button"
    >
      <span className="project-module-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span className="project-module-label">{item.label}</span>
    </button>
  );
}

export function ProjectModuleRail({ activeModule, onNavigate }: ProjectModuleRailProps) {
  const mainItems = moduleItems.filter((item) => item.group !== "bottom");
  const bottomItems = moduleItems.filter((item) => item.group === "bottom");

  return (
    <nav className="project-module-rail" aria-label="项目模块">
      <div className="project-module-group">
        {mainItems.map((item) => renderModuleButton(item, activeModule, onNavigate))}
      </div>
      <div className="project-module-group bottom">
        {bottomItems.map((item) => renderModuleButton(item, activeModule, onNavigate))}
      </div>
    </nav>
  );
}
