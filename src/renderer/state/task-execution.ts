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

export type TaskExecutionStepStatus = "pending" | "active" | "complete" | "error" | "stopped";

export type TaskExecutionStep = {
  readonly id: "selection" | "setup" | "generation" | "result";
  readonly status: TaskExecutionStepStatus;
};

const completeSteps: readonly TaskExecutionStep[] = [
  { id: "selection", status: "complete" },
  { id: "setup", status: "complete" },
  { id: "generation", status: "complete" },
  { id: "result", status: "complete" }
];

export function buildTaskExecutionSteps(
  phase: TaskExecutionPhase,
  hasSelection: boolean
): readonly TaskExecutionStep[] {
  if (!hasSelection) {
    return [
      { id: "selection", status: "active" },
      { id: "setup", status: "pending" },
      { id: "generation", status: "pending" },
      { id: "result", status: "pending" }
    ];
  }

  if (phase === "complete") {
    return completeSteps;
  }

  if (phase === "idle" || phase === "creating" || phase === "preparing") {
    return [
      { id: "selection", status: "complete" },
      { id: "setup", status: "active" },
      { id: "generation", status: "pending" },
      { id: "result", status: "pending" }
    ];
  }

  if (phase === "ready") {
    return [
      { id: "selection", status: "complete" },
      { id: "setup", status: "complete" },
      { id: "generation", status: "pending" },
      { id: "result", status: "pending" }
    ];
  }

  if (phase === "requesting" || phase === "streaming" || phase === "canceling") {
    return [
      { id: "selection", status: "complete" },
      { id: "setup", status: "complete" },
      { id: "generation", status: "active" },
      { id: "result", status: "pending" }
    ];
  }

  if (phase === "finalizing") {
    return [
      { id: "selection", status: "complete" },
      { id: "setup", status: "complete" },
      { id: "generation", status: "complete" },
      { id: "result", status: "active" }
    ];
  }

  return [
    { id: "selection", status: "complete" },
    { id: "setup", status: "complete" },
    { id: "generation", status: phase === "error" ? "error" : "stopped" },
    { id: "result", status: "pending" }
  ];
}
