export type TaskExecutionPhase =
  | "idle"
  | "creating"
  | "preparing"
  | "ready"
  | "requesting"
  | "streaming"
  | "finalizing"
  | "complete"
  | "canceling"
  | "canceled"
  | "error";

export type TaskExecutionActivityStatus = "active" | "complete" | "error" | "stopped";

export type TaskExecutionActivity = {
  readonly id: "context" | "generation" | "result";
  readonly status: TaskExecutionActivityStatus;
};

export function buildTaskExecutionActivities(
  phase: TaskExecutionPhase,
  hasTask: boolean
): readonly TaskExecutionActivity[] {
  if (phase === "idle" || phase === "ready") {
    return [];
  }

  if (phase === "creating" || phase === "preparing") {
    return [{ id: "context", status: "active" }];
  }

  if (phase === "requesting" || phase === "streaming" || phase === "canceling") {
    return [
      { id: "context", status: "complete" },
      { id: "generation", status: "active" }
    ];
  }

  if (phase === "finalizing") {
    return [
      { id: "context", status: "complete" },
      { id: "generation", status: "complete" },
      { id: "result", status: "active" }
    ];
  }

  if (phase === "complete") {
    return [
      { id: "context", status: "complete" },
      { id: "generation", status: "complete" },
      { id: "result", status: "complete" }
    ];
  }

  if (phase === "error" && !hasTask) {
    return [{ id: "context", status: "error" }];
  }

  return [
    { id: "context", status: "complete" },
    { id: "generation", status: phase === "error" ? "error" : "stopped" }
  ];
}
