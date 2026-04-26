export type MainViewId = 'start' | 'import' | 'workspace' | 'canon' | 'memory' | 'timeline' | 'settings' | 'export';

export type WorkspacePageId = 'editor' | 'chat' | 'polish' | 'expand' | 'proofread' | 'continuity' | 'search';

export type AppPageId = Exclude<MainViewId, 'workspace'> | WorkspacePageId;

export type AgentUiMode = 'plan' | 'build';

export type AgentInstructionPreset = 'none' | 'evidence' | 'polish' | 'continuity';

export const prototypeNavigationLabel = '原型导航';

export const mainViews: Array<{ id: MainViewId; label: string }> = [
  { id: 'start', label: '开始' },
  { id: 'import', label: '导入流程' },
  { id: 'workspace', label: '项目工作区' },
  { id: 'canon', label: '全局设定' },
  { id: 'memory', label: '记忆库' },
  { id: 'timeline', label: '时间线' },
  { id: 'settings', label: '模型设置' },
  { id: 'export', label: '导出' },
];

export const workspaceViews: Array<{ id: WorkspacePageId; label: string; sublabel: string }> = [
  { id: 'editor', label: '正文', sublabel: '编辑' },
  { id: 'chat', label: '对话', sublabel: 'Agent' },
  { id: 'polish', label: '润色', sublabel: '优化' },
  { id: 'expand', label: '扩写', sublabel: '场景' },
  { id: 'proofread', label: '校对', sublabel: '语言' },
  { id: 'continuity', label: '查矛盾', sublabel: '证据' },
  { id: 'search', label: '搜索', sublabel: '引用' },
];

export const agentInstructionPresets: Record<AgentInstructionPreset, { label: string; instruction: string }> = {
  none: { label: '无指令', instruction: '' },
  evidence: { label: '证据优先', instruction: '证据优先：所有判断都必须说明使用了哪些段落或设定来源；证据不足时直接说明。' },
  polish: { label: '保守润色', instruction: '保守润色：保持事实、视角、人物语气和叙事节奏，不主动新增设定。' },
  continuity: { label: '连续性检查', instruction: '连续性检查：优先找时间线、知情范围、道具状态、关系变化和因果缺口。' },
};

export function isWorkspacePage(page: AppPageId): page is WorkspacePageId {
  return workspaceViews.some((view) => view.id === page);
}

export function primaryViewForPage(page: AppPageId): MainViewId {
  return isWorkspacePage(page) ? 'workspace' : page;
}

export function agentBackendModeForUiMode(mode: AgentUiMode): 'investigate' | 'draft' {
  return mode === 'build' ? 'draft' : 'investigate';
}

export function buildAgentMessageWithInstruction(message: string, preset: AgentInstructionPreset): string {
  const instruction = agentInstructionPresets[preset].instruction;
  return instruction ? `${instruction}\n\n${message}` : message;
}
