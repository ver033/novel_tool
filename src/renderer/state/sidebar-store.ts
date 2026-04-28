import type { AiTaskStatus, CandidateStatus, TaskType } from "../../main/shared/types";

export const taskLabels: Record<TaskType, string> = {
  polish: "润色",
  expand: "扩写",
  proofread: "校对",
  continue: "续写"
};

export const taskStatusLabels: Record<AiTaskStatus, string> = {
  empty: "未配置",
  configured: "已配置",
  generating: "生成中",
  preview_ready: "预览完成",
  failed: "生成失败",
  applied: "已应用",
  inserted: "已插入",
  saved_to_scratchpad: "已加入草稿纸"
};

export const candidateStatusLabels: Record<CandidateStatus, string> = {
  preview: "预览",
  applied: "已替换",
  inserted: "已插入",
  rejected: "已拒绝",
  copied: "已复制",
  inserted_to_scratchpad: "已加入草稿纸"
};
