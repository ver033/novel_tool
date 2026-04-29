import { ArrowRight, BookOpen, DotsThree, FileText, Plus, UploadSimple } from "@phosphor-icons/react";
import { useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Modal } from "../components/Modal";
import { TopBar } from "../layout/TopBar";
import type { ProjectRecord } from "../../main/shared/types";

type WelcomePageProps = {
  readonly onContinueWriting: () => void;
  readonly onOpenProject: (projectId: string) => void;
  readonly onRenameProject: (projectId: string, name: string) => void;
  readonly onDeleteProject: (projectId: string, currentName: string) => void;
  readonly onNewProject: () => void;
  readonly onImport: () => void;
  readonly onSettings: () => void;
  readonly recentProjects: readonly ProjectRecord[];
  readonly welcomeNotice: string | null;
};

function formatProjectTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
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
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  const [renameProjectDraft, setRenameProjectDraft] = useState<{ id: string; name: string } | null>(null);
  const [renameProjectName, setRenameProjectName] = useState("");
  const continueHint = welcomeNotice ?? "选择项目文件，或从下方最近项目继续写作。";

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
      <TopBar title="墨枢" subtitle="专注创作，静心成书" mode="welcome" onWelcome={() => undefined} onSettings={onSettings} />

      <main className="main welcome-grid">
        <section>
          <div className="panel welcome-hero">
            <div>
              <h1 className="section-title">开始创作</h1>
              <div className="start-list">
                <button className="start-card" onClick={onContinueWriting} type="button">
                  <span className="start-icon blue">
                    <FileText size={28} />
                  </span>
                  <span>
                    <span className="start-main">继续写作</span>
                    <br />
                    <span className="start-sub">打开已有作品，继续你的故事</span>
                  </span>
                  <ArrowRight size={22} />
                </button>
                <button className="start-card" onClick={onNewProject} type="button">
                  <span className="start-icon green">
                    <Plus size={28} />
                  </span>
                  <span>
                    <span className="start-main">新建作品</span>
                    <br />
                    <span className="start-sub">从空白开始，创建新的小说</span>
                  </span>
                  <ArrowRight size={22} />
                </button>
                <button className="start-card" onClick={onImport} type="button">
                  <span className="start-icon purple">
                    <UploadSimple size={29} />
                  </span>
                  <span>
                    <span className="start-main">导入小说</span>
                    <br />
                    <span className="start-sub">导入本地文档，继续创作</span>
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
              <h2 className="section-title">最近项目</h2>
            </div>
            {recentProjects.length === 0 ? <p className="muted">暂无最近项目。可以新建作品，或从 TXT 导入开始。</p> : null}
            {recentProjects.map((project) => (
              <div className="project-row" key={project.id}>
                <button className="project-main-button" onClick={() => onOpenProject(project.id)} type="button">
                  <span className="cover" />
                  <span>
                    <span className="project-title">《{project.name}》</span>
                    <br />
                    <span className="muted">上次编辑：{formatProjectTime(project.updatedAt)}</span>
                  </span>
                  <span className="muted">本地项目</span>
                </button>
                <span className="project-actions">
                  <button className="project-menu-button" onClick={(event) => toggleProjectMenu(event, project.id)} type="button" aria-label={`打开《${project.name}》项目菜单`}>
                    <DotsThree size={24} weight="bold" />
                  </button>
                  {menuProjectId === project.id ? (
                    <span className="project-menu">
                      <button onClick={() => startProjectRename(project)} type="button">
                        重命名
                      </button>
                      <button className="danger" onClick={() => runProjectAction(() => onDeleteProject(project.id, project.name))} type="button">
                        删除项目
                      </button>
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
            <p className="muted">点击项目可直接打开</p>
          </div>
        </section>

        <aside className="side-stack">
          <div className="panel side-panel">
            <h2 className="section-title">开始建议</h2>
            <div className="tips">
              <Tip icon={<Plus size={22} />} title="先定大纲，再落笔成章" description="清晰的结构能让你的故事更有张力" />
              <Tip icon={<FileText size={22} />} title="保持定期备份" description="在「设置」中开启自动备份，安心创作" />
              <Tip icon={<BookOpen size={22} />} title="设定写作目标" description="每天进步一点点，积累成就感" />
            </div>
          </div>
          <div className="panel side-panel">
            <div className="panel-head">
              <h2 className="section-title">最近打开</h2>
            </div>
            <div className="tips compact">
              {recentProjects.slice(0, 2).map((project) => (
                <button className="recent-open-row link-row" key={project.id} onClick={() => onOpenProject(project.id)} type="button">
                  <span className="line-icon">
                    <FileText size={21} />
                  </span>
                  <span>
                    《{project.name}》
                    <br />
                    <span className="muted">{formatProjectTime(project.updatedAt)}</span>
                  </span>
                </button>
              ))}
              {recentProjects.length === 0 ? (
                <button className="recent-open-row link-row" onClick={onContinueWriting} type="button">
                  <span className="line-icon">
                    <FileText size={21} />
                  </span>
                  <span>
                    暂无最近打开
                    <br />
                    <span className="muted">新建作品或导入 TXT 后会显示在这里</span>
                  </span>
                </button>
              ) : null}
            </div>
          </div>
        </aside>
      </main>

      <Modal open={Boolean(renameProjectDraft)} title="重命名项目" onClose={cancelProjectRename}>
        <form className="rename-form" onSubmit={submitProjectRename}>
          <label className="field-label" htmlFor="project-rename-input">
            项目名称
          </label>
          <Input
            autoFocus
            id="project-rename-input"
            value={renameProjectName}
            onChange={(event) => setRenameProjectName(event.target.value)}
          />
          <div className="modal-actions">
            <Button onClick={cancelProjectRename} type="button" variant="ghost">
              取消
            </Button>
            <Button disabled={!renameProjectName.trim() || renameProjectName.trim() === renameProjectDraft?.name} type="submit" variant="primary">
              保存
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
