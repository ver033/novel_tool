import { ArrowRight, BookOpen, DotsThree, FileText, Plus, UploadSimple } from "@phosphor-icons/react";
import { useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Modal } from "../components/Modal";
import { TopBar } from "../layout/TopBar";
import type { ProjectRecord, RecentProjectEntry } from "../../main/shared/types";
import { useI18n, type TranslationKey } from "../i18n";

type WelcomePageProps = {
  readonly onContinueWriting: () => void;
  readonly onOpenProject: (projectId: string) => void;
  readonly onRenameProject: (projectId: string, name: string) => void;
  readonly onDeleteProject: (projectId: string, currentName: string) => void;
  readonly onNewProject: () => void;
  readonly onImport: () => void;
  readonly onSettings: () => void;
  readonly recentProjects: readonly RecentProjectEntry[];
  readonly welcomeNotice: string | null;
};

function formatProjectTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getProjectAvailabilityLabel(entry: RecentProjectEntry, t: (key: TranslationKey) => string): string {
  if (entry.availability === "missing") {
    return t("missingProject");
  }
  if (entry.availability === "invalid_path") {
    return t("invalidProjectPath");
  }
  return t("localProject");
}

export function WelcomePage({
  onContinueWriting,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  onNewProject,
  onImport,
  onSettings,
  recentProjects,
  welcomeNotice
}: WelcomePageProps) {
  const { locale, t } = useI18n();
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  const [renameProjectDraft, setRenameProjectDraft] = useState<{ id: string; name: string } | null>(null);
  const [renameProjectName, setRenameProjectName] = useState("");
  const continueHint = welcomeNotice ?? t("chooseProjectHint");

  function toggleProjectMenu(event: MouseEvent, projectId: string): void {
    event.stopPropagation();
    setMenuProjectId((current) => (current === projectId ? null : projectId));
  }

  function runProjectAction(action: () => void): void {
    setMenuProjectId(null);
    action();
  }

  function startProjectRename(project: ProjectRecord): void {
    setMenuProjectId(null);
    setRenameProjectDraft({ id: project.id, name: project.name });
    setRenameProjectName(project.name);
  }

  function cancelProjectRename(): void {
    setRenameProjectDraft(null);
    setRenameProjectName("");
  }

  function submitProjectRename(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!renameProjectDraft) {
      return;
    }

    const name = renameProjectName.trim();
    if (!name) {
      return;
    }

    if (name !== renameProjectDraft.name) {
      onRenameProject(renameProjectDraft.id, name);
    }

    cancelProjectRename();
  }

  return (
    <div className="welcome-page" onClick={() => setMenuProjectId(null)}>
      <TopBar title="墨枢" subtitle={t("brandTagline")} mode="welcome" onWelcome={() => undefined} onSettings={onSettings} />

      <main className="main welcome-grid">
        <section>
          <div className="panel welcome-hero">
            <div>
              <h1 className="section-title">{t("startCreating")}</h1>
              <div className="start-list">
                <button className="start-card" onClick={onContinueWriting} type="button">
                  <span className="start-icon blue">
                    <FileText size={28} />
                  </span>
                  <span>
                    <span className="start-main">{t("continueWriting")}</span>
                    <br />
                    <span className="start-sub">{t("continueWritingDescription")}</span>
                  </span>
                  <ArrowRight size={22} />
                </button>
                <button className="start-card" onClick={onNewProject} type="button">
                  <span className="start-icon green">
                    <Plus size={28} />
                  </span>
                  <span>
                    <span className="start-main">{t("newWork")}</span>
                    <br />
                    <span className="start-sub">{t("newWorkDescription")}</span>
                  </span>
                  <ArrowRight size={22} />
                </button>
                <button className="start-card" onClick={onImport} type="button">
                  <span className="start-icon purple">
                    <UploadSimple size={29} />
                  </span>
                  <span>
                    <span className="start-main">{t("importNovel")}</span>
                    <br />
                    <span className="start-sub">{t("importNovelDescription")}</span>
                  </span>
                  <ArrowRight size={22} />
                </button>
              </div>
              {welcomeNotice ? <div className="notice welcome-notice">{continueHint}</div> : null}
            </div>
            <div className="book-ghost" aria-hidden="true">
              <svg viewBox="0 0 280 180" width="280" height="180" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M58 42c35-16 65-12 88 12v104c-27-19-57-23-88-12V42Z" />
                <path d="M146 54c30-24 60-28 90-12v104c-34-11-64-7-90 12V54Z" />
                <path d="M72 68h48M72 88h50M72 108h42M170 68h45M170 88h48M170 108h37" />
                <path d="M184 152l70 20" />
              </svg>
            </div>
          </div>

          <div className="panel recent">
            <div className="recent-head">
              <h2 className="section-title">{t("recentProjects")}</h2>
            </div>
            {recentProjects.length === 0 ? <p className="muted">{t("noRecentProjectsHint")}</p> : null}
            {recentProjects.map((entry) => {
              const project = entry.project;
              const available = entry.availability === "available";
              return (
              <div className="project-row" key={project.id}>
                <button className="project-main-button" disabled={!available} onClick={() => onOpenProject(project.id)} type="button">
                  <span className="cover" />
                  <span>
                    <span className="project-title">《{project.name}》</span>
                    <br />
                    <span className="muted">{t("lastEdited")}：{formatProjectTime(project.updatedAt, locale)}</span>
                  </span>
                  <span className="muted">{getProjectAvailabilityLabel(entry, t)}</span>
                </button>
                <span className="project-actions">
                  <button className="project-menu-button" onClick={(event) => toggleProjectMenu(event, project.id)} type="button" aria-label={`${t("openProjectMenu")}：${project.name}`}>
                    <DotsThree size={24} weight="bold" />
                  </button>
                  {menuProjectId === project.id ? (
                    <span className="project-menu">
                      <button onClick={() => startProjectRename(project)} type="button">
                        {t("rename")}
                      </button>
                      <button className="danger" onClick={() => runProjectAction(() => onDeleteProject(project.id, project.name))} type="button">
                        {t("deleteProject")}
                      </button>
                    </span>
                  ) : null}
                </span>
              </div>
              );
            })}
            <p className="muted">{t("clickProjectToOpen")}</p>
          </div>
        </section>

        <aside className="side-stack">
          <div className="panel side-panel">
            <h2 className="section-title">{t("gettingStartedTips")}</h2>
            <div className="tips">
              <Tip icon={<Plus size={22} />} title={t("tipOutlineTitle")} description={t("tipOutlineDescription")} />
              <Tip icon={<FileText size={22} />} title={t("tipBackupTitle")} description={t("tipBackupDescription")} />
              <Tip icon={<BookOpen size={22} />} title={t("tipGoalTitle")} description={t("tipGoalDescription")} />
            </div>
          </div>
          <div className="panel side-panel">
            <div className="panel-head">
              <h2 className="section-title">{t("recentlyOpened")}</h2>
            </div>
            <div className="tips compact">
              {recentProjects.slice(0, 2).map((entry) => (
                <button
                  className="recent-open-row link-row"
                  disabled={entry.availability !== "available"}
                  key={entry.project.id}
                  onClick={() => onOpenProject(entry.project.id)}
                  type="button"
                >
                  <span className="line-icon">
                    <FileText size={21} />
                  </span>
                  <span>
                    《{entry.project.name}》
                    <br />
                    <span className="muted">{entry.availability === "available" ? formatProjectTime(entry.project.updatedAt, locale) : getProjectAvailabilityLabel(entry, t)}</span>
                  </span>
                </button>
              ))}
              {recentProjects.length === 0 ? (
                <button className="recent-open-row link-row" onClick={onContinueWriting} type="button">
                  <span className="line-icon">
                    <FileText size={21} />
                  </span>
                  <span>
                    {t("noRecentlyOpened")}
                    <br />
                    <span className="muted">{t("recentlyOpenedHint")}</span>
                  </span>
                </button>
              ) : null}
            </div>
          </div>
        </aside>
      </main>

      <Modal open={Boolean(renameProjectDraft)} title={t("renameProject")} onClose={cancelProjectRename}>
        <form className="rename-form" onSubmit={submitProjectRename}>
          <label className="field-label" htmlFor="project-rename-input">
            {t("projectName")}
          </label>
          <Input
            autoFocus
            id="project-rename-input"
            value={renameProjectName}
            onChange={(event) => setRenameProjectName(event.target.value)}
          />
          <div className="modal-actions">
            <Button onClick={cancelProjectRename} type="button" variant="ghost">
              {t("cancel")}
            </Button>
            <Button disabled={!renameProjectName.trim() || renameProjectName.trim() === renameProjectDraft?.name} type="submit" variant="primary">
              {t("save")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Tip({ icon, title, description }: { readonly icon: ReactNode; readonly title: string; readonly description: string }) {
  return (
    <div className="tip-row">
      <span className="line-icon">{icon}</span>
      <span>
        <b>{title}</b>
        <br />
        <span className="tip-desc">{description}</span>
      </span>
    </div>
  );
}
