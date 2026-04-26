import type { ProjectConfig } from '../shared/project-config-schema';

export type ProviderId = 'deepseek' | 'openrouter';
export type TaskModelProfile = ProjectConfig['taskModelProfile'];
export type TaskType = keyof TaskModelProfile;
export type TaskModelSetting = TaskModelProfile[TaskType];

export const providerCards: Array<{
  id: ProviderId;
  mark: string;
  title: string;
  subtitle: string;
  scopeBadge: string;
  baseUrl: string;
  modelScope: string;
}> = [
  {
    id: 'deepseek',
    mark: 'DS',
    title: 'DeepSeek',
    subtitle: '直连接口 · V4 系列',
    scopeBadge: '直连',
    baseUrl: 'https://api.deepseek.com',
    modelScope: 'DeepSeek V4 Pro / V4 Flash。',
  },
  {
    id: 'openrouter',
    mark: 'OR',
    title: 'OpenRouter',
    subtitle: '模型网关 · 自定义模型',
    scopeBadge: '网关',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelScope: '可填写 OpenRouter 上的任意模型 ID。',
  },
];

export const settingsTaskRows: Array<{
  task: Exclude<TaskType, 'memory'>;
  label: string;
  scope: string;
  note: string;
}> = [
  { task: 'chat', label: '对话 Agent', scope: '项目问答', note: '计划、检索、证据整理、方案输出。' },
  { task: 'continuity', label: '检查矛盾', scope: '连续性', note: '跨章节事实判断，证据不足时返回不确定。' },
  { task: 'expand', label: '扩写', scope: '场景草稿', note: '覆盖情节要点，列出新增事实。' },
  { task: 'polish', label: '润色', scope: '选段优化', note: '保守改写，默认不新增解释。' },
  { task: 'proofread', label: '校对', scope: '语言检查', note: '错字、标点、称谓、局部表达。' },
];

export function providerDefaultModel(providerId: ProviderId, role: TaskModelSetting['modelRole']): string {
  if (providerId === 'deepseek') {
    return role === 'pro' ? 'deepseek-v4-pro' : 'deepseek-v4-flash';
  }
  return role === 'pro' ? 'deepseek/deepseek-v4-pro' : 'deepseek/deepseek-v4-flash';
}

export function reasoningEffortLabel(value: TaskModelSetting['reasoningEffort']): string {
  return value === 'max' ? '最高思考' : '高思考';
}

export function thinkingModeLabel(value: TaskModelSetting['thinkingMode']): string {
  return value === 'enabled' ? '开启思考' : '关闭思考';
}
