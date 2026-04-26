export function buildPendingFeatureStatus(featureName: string): string {
  return `${featureName}会在后续阶段接入；当前阶段不会伪装成功。`;
}

export type AiTaskPage = 'chat' | 'polish' | 'proofread' | 'expand' | 'continuity' | 'memory';
export type AiTaskType = 'chat' | 'polish' | 'proofread' | 'expand' | 'continuity' | 'memory';

export function isAiTaskPage(page: string): page is AiTaskPage {
  return ['chat', 'polish', 'proofread', 'expand', 'continuity', 'memory'].includes(page);
}

export function taskTypeForPage(page: AiTaskPage): AiTaskType {
  return page;
}
