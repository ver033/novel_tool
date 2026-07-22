import { BookOpen, ChartBar, Files, GearSix, Graph, ListBullets, MagnifyingGlass, Target, Trash } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useI18n } from "../i18n";

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
  const { t } = useI18n();
  const moduleItems: readonly ProjectModuleItem[] = [
    { id: "writing", label: t("manuscript"), icon: <BookOpen size={22} /> },
    { id: "relationshipGraph", label: t("relationshipGraph"), icon: <Graph size={22} /> },
    { id: "outline", label: t("outline"), icon: <ListBullets size={22} /> },
    { id: "chapterReview", label: t("aiReview"), icon: <MagnifyingGlass size={22} /> },
    { id: "materials", label: t("materials"), icon: <Files size={22} />, disabled: true, title: t("planning") },
    { id: "goals", label: t("writingGoals"), icon: <Target size={22} /> },
    { id: "stats", label: t("statistics"), icon: <ChartBar size={22} />, disabled: true, title: t("planning") },
    { id: "trash", label: t("trash"), icon: <Trash size={22} />, disabled: true, title: t("planning") },
    { id: "settings", label: t("settings"), icon: <GearSix size={22} />, group: "bottom" }
  ];
  const mainItems = moduleItems.filter((item) => item.group !== "bottom");
  const bottomItems = moduleItems.filter((item) => item.group === "bottom");

  return (
    <nav className="project-module-rail" aria-label={t("projectModules")}>
      <div className="project-module-group">
        {mainItems.map((item) => renderModuleButton(item, activeModule, onNavigate))}
      </div>
      <div className="project-module-group bottom">
        {bottomItems.map((item) => renderModuleButton(item, activeModule, onNavigate))}
      </div>
    </nav>
  );
}
