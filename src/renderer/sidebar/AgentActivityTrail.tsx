import {
  CaretRight,
  CheckCircle,
  Circle,
  ListChecks,
  SpinnerGap,
  StopCircle,
  WarningCircle,
  Wrench
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AiAgentActivityRecord } from "../../main/shared/types";
import { useI18n } from "../i18n";

type AgentActivityTrailProps = {
  readonly activities: readonly AiAgentActivityRecord[];
};

type ActivityStatus = AiAgentActivityRecord["status"];

function StateIcon({ status }: { readonly status: ActivityStatus }) {
  if (status === "complete") return <CheckCircle size={16} weight="fill" />;
  if (status === "error" || status === "blocked") return <WarningCircle size={16} weight="fill" />;
  if (status === "stopped") return <StopCircle size={16} weight="fill" />;
  if (status === "running") return <SpinnerGap className="agent-process-spinner" size={16} weight="bold" />;
  return <Circle size={13} weight="regular" />;
}

function overallStatus(activities: readonly AiAgentActivityRecord[]): "running" | "error" | "stopped" | "complete" {
  if (activities.some((item) => item.status === "running" || item.status === "pending" || item.status === "blocked")) return "running";
  if (activities.some((item) => item.status === "error")) return "error";
  if (activities.some((item) => item.status === "stopped")) return "stopped";
  return "complete";
}

export function AgentActivityTrail({ activities }: AgentActivityTrailProps) {
  const { t } = useI18n();
  const tools = useMemo(() => activities.filter((item) => item.kind === "tool"), [activities]);
  const tasks = useMemo(() => activities.filter((item) => item.kind === "task"), [activities]);
  const running = tools.some((item) => item.status === "running");
  const needsAttention = tools.some((item) => item.status === "error" || item.status === "blocked" || item.status === "stopped");
  const [expanded, setExpanded] = useState(running);
  const userToggled = useRef(false);
  const wasRunning = useRef(running);

  useEffect(() => {
    if (needsAttention) {
      if (!userToggled.current) setExpanded(true);
      wasRunning.current = false;
      return;
    }
    if (running) {
      if (!userToggled.current) setExpanded(true);
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current || userToggled.current) return;
    wasRunning.current = false;
    const timer = window.setTimeout(() => setExpanded(false), 900);
    return () => window.clearTimeout(timer);
  }, [needsAttention, running]);

  if (tools.length === 0 && tasks.length === 0) return null;

  const processStatus = overallStatus(tools);
  const processStatusLabel = processStatus === "running"
    ? t("agentProcessRunning")
    : processStatus === "error"
      ? t("agentProcessError")
      : processStatus === "stopped"
        ? t("agentProcessStopped")
        : t("agentProcessComplete");
  const completedTasks = tasks.filter((task) => task.status === "complete").length;

  return (
    <>
      {tools.length > 0 ? (
        <section className={`agent-process ${processStatus}`} aria-label={t("agentProcess")}>
          <button
            aria-expanded={expanded}
            className="agent-process-toggle"
            onClick={() => {
              userToggled.current = true;
              setExpanded((current) => !current);
            }}
            title={expanded ? t("agentCollapseProcess") : t("agentExpandProcess")}
            type="button"
          >
            <CaretRight className={expanded ? "expanded" : ""} size={14} weight="bold" />
            <Wrench size={15} weight="regular" />
            <strong>{t("agentProcess")}</strong>
            <span>{t("agentProcessSummary", { count: tools.length })}</span>
            <small>{processStatusLabel}</small>
          </button>
          {expanded ? (
            <ol className="agent-process-list">
              {tools.map((item) => (
                <li className={`agent-process-item ${item.status}`} key={item.id}>
                  <span className="agent-process-icon" aria-hidden="true"><StateIcon status={item.status} /></span>
                  <div className="agent-process-copy">
                    <strong>{item.title}</strong>
                    {item.detail ? <small>{item.detail}</small> : null}
                    {item.input || item.output ? (
                      <details className="agent-process-details">
                        <summary>{t("agentToolDetails")}</summary>
                        {item.input ? <div><b>{t("agentToolInput")}</b><pre>{item.input}</pre></div> : null}
                        {item.output ? <div><b>{t("agentToolOutput")}</b><pre>{item.output}</pre></div> : null}
                      </details>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}

      {tasks.length > 0 ? (
        <section className="agent-task-progress" aria-label={t("agentTaskProgress")}>
          <div className="agent-task-progress-head">
            <ListChecks size={16} weight="regular" />
            <strong>{t("agentTaskProgress")}</strong>
            <span>{t("agentTaskCount", { completed: completedTasks, total: tasks.length })}</span>
          </div>
          <div className="agent-task-progress-track" aria-hidden="true">
            <span style={{ transform: `scaleX(${tasks.length > 0 ? completedTasks / tasks.length : 0})` }} />
          </div>
          <ol className="agent-task-progress-list">
            {tasks.map((task) => {
              const label = task.status === "running"
                ? t("agentTaskRunning")
                : task.status === "complete"
                  ? t("agentTaskComplete")
                  : task.status === "blocked"
                    ? t("agentTaskBlocked")
                    : task.status === "error"
                      ? t("agentTaskError")
                      : task.status === "stopped"
                        ? t("agentTaskStopped")
                        : t("agentTaskPending");
              return (
                <li className={task.status} key={task.id}>
                  <span aria-hidden="true"><StateIcon status={task.status} /></span>
                  <div>
                    <strong>{task.status === "running" && task.activeForm ? task.activeForm : task.title}</strong>
                    {task.detail ? <small>{task.detail}</small> : null}
                  </div>
                  <em>{label}</em>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </>
  );
}
