import {
  BookOpenText,
  Brain,
  ChatCircleText,
  ClockCounterClockwise,
  FileText,
  GearSix,
  MagnifyingGlass,
  Notebook,
  PenNib,
  SealCheck,
  Sparkle,
  TreeStructure,
  WarningCircle,
} from '@phosphor-icons/react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { IpcResponse } from '../shared/ipc-contracts';
import { clearParagraphDirty, markParagraphDirty } from './autosave-state';
import { buildPendingFeatureStatus, isAiTaskPage, taskTypeForPage } from './page-actions';
import { pickInitialChapterId, shouldLoadWorkspaceProject } from './editor-project-state';
import {
  buildTextScope,
  canRunQuickAction,
  editorQuickActionButtons,
  routeQuickAction,
  type QuickActionKind,
  type TextActionScope,
} from './quick-actions';
import { buildRevisionDiffRows, previewRevisionText } from './revision-diff';
import { buildReferenceRouteStatus, buildSearchJumpStatus, isHighlightedParagraph } from './search-actions';
import {
  providerCards,
  providerDefaultModel,
  reasoningEffortLabel,
  settingsTaskRows,
} from './settings-view-model';
import { emptyRecentProjectCopy, openReturnCards, recentProjectRows, startHeroCopy } from './start-view-model';
import { buildStatusStripModel } from './status-strip';
import { userFacingErrorMessage } from './user-facing-error';
import {
  agentBackendModeForUiMode,
  agentInstructionPresets,
  buildAgentMessageWithInstruction,
  isWorkspacePage,
  mainViews,
  primaryViewForPage,
  prototypeNavigationLabel,
  workspaceViews,
  type AgentInstructionPreset,
  type AgentUiMode,
  type AppPageId,
  type MainViewId,
  type WorkspacePageId,
} from './ui-navigation';

type PageId = AppPageId;
type PanelPageId = WorkspacePageId | 'settings';

type TxtPreviewResult = IpcResponse<'imports.previewTxt'>;
type TxtCommitResult = IpcResponse<'imports.commitTxt'>;
type EpubPreviewResult = IpcResponse<'imports.previewEpub'>;
type EpubCommitResult = IpcResponse<'imports.commitEpub'>;
type ImportPreviewResult = TxtPreviewResult | EpubPreviewResult;
type ImportCommitResult = TxtCommitResult | EpubCommitResult;
type ManuscriptPickResult = IpcResponse<'imports.pickManuscript'>;
type ExistingProjectPickResult = IpcResponse<'project.pickExisting'>;
type ChapterListResult = IpcResponse<'chapters.list'>;
type EditableChapterResult = IpcResponse<'chapters.get'>;
type EditableParagraphResult = EditableChapterResult['paragraphs'][number];
type ParagraphUpdateResult = IpcResponse<'paragraphs.update'>;
type RevisionListResult = IpcResponse<'revisions.list'>;
type RevisionRestoreResult = IpcResponse<'revisions.restore'>;
type CandidateAcceptResult = IpcResponse<'revisions.acceptCandidate'>;
type CandidateRejectResult = IpcResponse<'revisions.rejectCandidate'>;
type AgentArtifactDecisionResult = IpcResponse<'agent.applyArtifact'>;
type SearchResult = IpcResponse<'search.query'>;
type SearchResultItem = SearchResult['results'][number];
type SearchReferencesResult = IpcResponse<'search.addToContext'>;
type ReferenceBasket = SearchReferencesResult['references'];
type JobsSnapshot = IpcResponse<'jobs.subscribe'>;
type ProjectConfigResult = IpcResponse<'config.get'>;
type AiTaskPreflightResult = IpcResponse<'ai.runTask'>;
type ChatAgentResult = IpcResponse<'chat.send'>;
type ProviderStatusResult = IpcResponse<'providers.status'>;
type TaskModelProfile = ProjectConfigResult['taskModelProfile'];
type TaskType = keyof TaskModelProfile;
type TaskModelSetting = TaskModelProfile[TaskType];
type IssueCard = IpcResponse<'issues.list'>['issues'][number];
type MemoryListResult = IpcResponse<'memory.list'>;
type MemoryCard = MemoryListResult['cards'][number];
type CanonListResult = IpcResponse<'canon.list'>;
type CanonRecord = CanonListResult['records'][number];
type CanonAnalyzeResult = IpcResponse<'canon.analyzeProject'>;
type TimelineQueryResult = IpcResponse<'timeline.query'>;
type TimelineAnalyzeResult = IpcResponse<'timeline.analyze'>;
type ExportPreviewResult = IpcResponse<'exports.preview'>;
type ExportRunResult = IpcResponse<'exports.run'>;
type ExportFormat = 'txt' | 'epub';

const sampleParagraphs = [
  '雨声贴着窗棂往下淌，像一层被揉皱的银箔。沈照把灯芯拨低，桌上的药碗还冒着细白的热气。',
  '他没有立刻喝药，只看着碗沿那一圈淡褐色的痕。半个时辰前，巡夜的脚步在巷口停过一次，又很快离开。',
  '门外传来极轻的叩响。三下，停一息，再两下。那是旧约定，也是她不该再知道的约定。',
];

const defaultTaskModelProfile: TaskModelProfile = {
  chat: { modelRole: 'pro', reasoningEffort: 'high', thinkingMode: 'enabled' },
  polish: { modelRole: 'flash', reasoningEffort: 'high', thinkingMode: 'disabled' },
  expand: { modelRole: 'pro', reasoningEffort: 'high', thinkingMode: 'enabled' },
  proofread: { modelRole: 'flash', reasoningEffort: 'high', thinkingMode: 'disabled' },
  continuity: { modelRole: 'pro', reasoningEffort: 'high', thinkingMode: 'enabled' },
  memory: { modelRole: 'flash', reasoningEffort: 'high', thinkingMode: 'enabled' },
};

function providerName(providerId: 'deepseek' | 'openrouter' | null | undefined): string {
  if (providerId === 'deepseek') {
    return 'DeepSeek';
  }
  if (providerId === 'openrouter') {
    return 'OpenRouter';
  }
  return '未选择';
}

type ConnectionStatusName = NonNullable<ProviderStatusResult['activeConnection']>['status'];

function connectionStatusLabel(status: ConnectionStatusName | undefined): string {
  if (status === 'connected') {
    return '已连接';
  }
  if (status === 'configured_untested') {
    return '未测试';
  }
  if (status === 'failed') {
    return '连接失败';
  }
  return '未配置';
}

function activeModelStatusText(providerStatus: ProviderStatusResult | null, hasDesktopApi: boolean): string {
  if (!hasDesktopApi) {
    return 'DeepSeek · deepseek-v4-pro · 高思考';
  }
  if (!providerStatus?.activeConnection) {
    return '模型未选择';
  }
  const model = providerStatus.activeConnection.model ?? connectionStatusLabel(providerStatus.activeConnection.status);
  return `${providerName(providerStatus.activeProvider)} · ${model} · 高思考`;
}

function canRunConnectedModelTask(providerStatus: ProviderStatusResult | null): boolean {
  return providerStatus?.activeConnection?.status === 'connected';
}

function modelGateMessage(providerStatus: ProviderStatusResult | null, hasDesktopApi: boolean): string | null {
  if (!hasDesktopApi) {
    return '浏览器预览不能连接模型；桌面应用会使用当前激活供应商运行 AI 任务。';
  }
  if (!providerStatus?.activeConnection) {
    return '先在模型设置里选择 DeepSeek 或 OpenRouter。';
  }
  if (providerStatus.activeConnection.status === 'not_configured') {
    return `当前激活的是 ${providerName(providerStatus.activeProvider)}，还没有保存 API Key。`;
  }
  if (providerStatus.activeConnection.status === 'configured_untested') {
    return `${providerName(providerStatus.activeProvider)} 的 API Key 已保存，需要先测试连接。`;
  }
  if (providerStatus.activeConnection.status === 'failed') {
    return providerStatus.activeConnection.error
      ? `上次连接失败：${providerStatus.activeConnection.error}`
      : '上次连接失败，请重新测试当前供应商。';
  }
  return null;
}

function pageTitleFor(page: PageId): string {
  return (
    workspaceViews.find((view) => view.id === page)?.label ??
    mainViews.find((view) => view.id === page)?.label ??
    '正文'
  );
}

function navigateLabelFor(view: MainViewId): string {
  return mainViews.find((item) => item.id === view)?.label ?? view;
}

export function App() {
  const [activePage, setActivePage] = useState<PageId>('start');
  const [lastWorkspacePage, setLastWorkspacePage] = useState<WorkspacePageId>('editor');
  const [projectName, setProjectName] = useState('长夜试稿');
  const [baseDirectory, setBaseDirectory] = useState('/tmp');
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [selectedFileType, setSelectedFileType] = useState<'txt' | 'epub'>('txt');
  const [txtPreview, setTxtPreview] = useState<ImportPreviewResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [status, setStatus] = useState('未打开项目');
  const [activeProvider, setActiveProvider] = useState<'deepseek' | 'openrouter' | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatusResult | null>(null);
  const [chapters, setChapters] = useState<ChapterListResult>([]);
  const [activeChapter, setActiveChapter] = useState<EditableChapterResult | null>(null);
  const [selectedParagraphId, setSelectedParagraphId] = useState<string | null>(null);
  const [editorStatus, setEditorStatus] = useState('尚未载入项目');
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchStatus, setSearchStatus] = useState('输入关键词后搜索当前项目正文');
  const [jobs, setJobs] = useState<JobsSnapshot['jobs']>([]);
  const [quickActionScope, setQuickActionScope] = useState<TextActionScope | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [revisionItems, setRevisionItems] = useState<RevisionListResult>([]);
  const [revisionStatus, setRevisionStatus] = useState('选择段落后显示版本历史');
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);
  const [dirtyParagraphIds, setDirtyParagraphIds] = useState<string[]>([]);
  const [highlightedParagraphId, setHighlightedParagraphId] = useState<string | null>(null);
  const [referenceBasket, setReferenceBasket] = useState<ReferenceBasket>([]);
  const [taskModelProfile, setTaskModelProfile] = useState<TaskModelProfile>(defaultTaskModelProfile);
  const [taskInstruction, setTaskInstruction] = useState('');
  const [agentMode, setAgentMode] = useState<AgentUiMode>('plan');
  const [agentInstructionPreset, setAgentInstructionPreset] = useState<AgentInstructionPreset>('none');
  const [agentExplicitReferences, setAgentExplicitReferences] = useState<ReferenceBasket>([]);
	  const [aiPreflight, setAiPreflight] = useState<AiTaskPreflightResult | null>(null);
	  const [aiTaskStatus, setAiTaskStatus] = useState('还没有准备任务上下文');
	  const [chatAgentResult, setChatAgentResult] = useState<ChatAgentResult | null>(null);
	  const [chatAgentStatus, setChatAgentStatus] = useState('输入问题后运行 Agent');
	  const [proofreadIssues, setProofreadIssues] = useState<IssueCard[]>([]);
	  const [issuePanelStatus, setIssuePanelStatus] = useState('运行校对后显示问题卡');
  const [memoryCards, setMemoryCards] = useState<MemoryCard[]>([]);
  const [memoryStatus, setMemoryStatus] = useState('打开项目后显示正文证据');
  const [canonStatus, setCanonStatus] = useState('点击分析项目生成全局设定');
  const [canonRecords, setCanonRecords] = useState<CanonRecord[]>([]);
  const [canonSources, setCanonSources] = useState<CanonListResult['sources']>([]);
  const [timelineResult, setTimelineResult] = useState<TimelineQueryResult | null>(null);
  const [timelineStatus, setTimelineStatus] = useState('打开项目后显示时间线事件');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('txt');
  const [exportPreview, setExportPreview] = useState<ExportPreviewResult | null>(null);
  const [exportOutputPath, setExportOutputPath] = useState('');
  const [exportStatus, setExportStatus] = useState('打开项目后生成导出预览');
  const [polishStrength, setPolishStrength] = useState<'light' | 'medium' | 'heavy'>('light');
  const [polishFocus, setPolishFocus] = useState('');
  const [polishForbiddenChanges, setPolishForbiddenChanges] = useState('');
  const [expandPreviousContext, setExpandPreviousContext] = useState('');
  const [expandNextBeats, setExpandNextBeats] = useState('');
  const [expandFocusDetails, setExpandFocusDetails] = useState('');
  const [expandForbiddenChanges, setExpandForbiddenChanges] = useState('');
  const [expandPov, setExpandPov] = useState('');
  const [expandTargetLength, setExpandTargetLength] = useState('');
  const [expandStyleStrength, setExpandStyleStrength] = useState('');
  const skipNextEditorReload = useRef(false);
  const hasDesktopApi = Boolean(window.novelTool);

  useEffect(() => {
    void refreshProviderStatus();
  }, []);

  useEffect(() => {
    if (isWorkspacePage(activePage)) {
      setLastWorkspacePage(activePage);
    }
  }, [activePage]);

  useEffect(() => {
    if (isWorkspacePage(activePage)) {
      if (skipNextEditorReload.current) {
        skipNextEditorReload.current = false;
        return;
      }
      if (
        shouldLoadWorkspaceProject({
          activeChapterId: activeChapter?.id ?? null,
          chapterCount: chapters.length,
          skipNextReload: false,
        })
      ) {
        void loadEditorProject();
      }
    } else {
      setContextMenu(null);
    }
  }, [activePage]);

	  useEffect(() => {
	    if (activePage === 'settings') {
	      void loadTaskModelProfile();
	    }
	  }, [activePage]);

	  useEffect(() => {
	    if (activePage === 'proofread') {
	      void loadProofreadIssues();
	    }
	  }, [activePage, selectedParagraphId]);

  useEffect(() => {
    if (activePage === 'canon') {
      void loadCanonRecords();
    }
  }, [activePage]);

  useEffect(() => {
    if (activePage === 'memory') {
      void loadMemoryCards();
    }
  }, [activePage]);

  useEffect(() => {
    if (activePage === 'timeline') {
      void loadTimeline();
    }
  }, [activePage]);

  useEffect(() => {
    if (activePage === 'export') {
      void refreshExportPreview(exportFormat);
    }
  }, [activePage, exportFormat]);

  useEffect(() => {
    setAiPreflight(null);
    setAiTaskStatus('还没有准备任务上下文');
    setTaskInstruction('');
  }, [activePage]);

  useEffect(() => {
    void refreshJobs();
  }, []);

  useEffect(() => {
    if (activePage === 'editor') {
      void loadRevisionHistory();
    }
  }, [activePage, selectedParagraphId]);

  useEffect(() => {
    if (!isWorkspacePage(activePage) || dirtyParagraphIds.length === 0 || !window.novelTool) {
      return undefined;
    }

    const pendingParagraphIds = [...dirtyParagraphIds];
    const timeoutId = window.setTimeout(() => {
      for (const paragraphId of pendingParagraphIds) {
        const paragraph = activeChapter?.paragraphs.find((item) => item.id === paragraphId);
        if (paragraph) {
          void saveParagraph(paragraph.id, paragraph.text, 'autosave');
        }
      }
    }, 1200);
    return () => window.clearTimeout(timeoutId);
  }, [activePage, activeChapter, dirtyParagraphIds]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setQuickActionScope(null);
        setContextMenu(null);
      }
    }

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  useEffect(() => {
    if (activePage !== 'editor') {
      return undefined;
    }

    function dismissFloatingSelection() {
      setQuickActionScope(null);
      setContextMenu(null);
    }

    window.addEventListener('wheel', dismissFloatingSelection, { capture: true, passive: true });
    window.addEventListener('scroll', dismissFloatingSelection, true);
    return () => {
      window.removeEventListener('wheel', dismissFloatingSelection, true);
      window.removeEventListener('scroll', dismissFloatingSelection, true);
    };
  }, [activePage]);

  const pageTitle = useMemo(() => pageTitleFor(activePage), [activePage]);

  function getSelectedParagraphScope(): TextActionScope | null {
    const paragraph = activeChapter?.paragraphs.find((item) => item.id === selectedParagraphId);
    if (!paragraph) {
      return null;
    }
    return buildTextScope({
      paragraphId: paragraph.id,
      friendlyLabel: paragraph.friendlyLabel,
      text: paragraph.text,
      selectionStart: 0,
      selectionEnd: 0,
    });
  }

  function runQuickAction(action: QuickActionKind, scope = quickActionScope) {
    const activeScope = scope ?? getSelectedParagraphScope();
    if (!activeScope) {
      setEditorStatus('请先选择正文段落或文本。');
      setStatus('请先选择正文段落或文本。');
      return;
    }
    const check = canRunQuickAction(action, activeScope);
    if (!check.ok) {
      setEditorStatus(check.reason);
      setStatus(check.reason);
      return;
    }
    const target = routeQuickAction(action);
    setContextMenu(null);
    setQuickActionScope(activeScope);
    if (target === 'chat') {
      setTaskInstruction(activeScope.kind === 'selection' ? '@当前选段 ' : '@当前段落 ');
      setAgentExplicitReferences([
        {
          paragraphId: activeScope.paragraphId,
          chapterId: activeChapter?.id ?? '',
          chapterTitle: activeChapter?.title ?? '',
          friendlyLocation: activeScope.scopeLabel,
          text: activeScope.selectedText,
        },
      ]);
    }
    skipNextEditorReload.current = true;
    setActivePage(target);
    setStatus(`已带入范围：${activeScope.scopeLabel}`);
  }

  function navigateMainView(viewId: MainViewId) {
    setActivePage(viewId === 'workspace' ? lastWorkspacePage : viewId);
  }

  function guessBaseDirectory(filePath: string): string {
    const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return index > 0 ? filePath.slice(0, index) : baseDirectory;
  }

  async function chooseManuscript() {
    if (!window.novelTool) {
      setStatus('浏览器预览中无法打开系统文件选择器，可以粘贴 TXT 路径测试界面状态');
      return;
    }

    const picked = (await window.novelTool.imports.pickManuscript()) as ManuscriptPickResult;
    if (picked.canceled) {
      setStatus('已取消选择文件');
      return;
    }
    setSelectedFilePath(picked.filePath);
    setSelectedFileType(picked.fileType);
    setBaseDirectory(guessBaseDirectory(picked.filePath));
    if (picked.fileType === 'txt') {
      await previewTxt(picked.filePath);
    } else {
      await previewEpub(picked.filePath);
    }
  }

  async function previewTxt(filePath = selectedFilePath) {
    if (!filePath.trim()) {
      setStatus('请先选择或输入 TXT 文件路径');
      return;
    }
    if (!window.novelTool) {
      setStatus('浏览器预览中不能读取本地 TXT；请在 Electron 应用中预览导入');
      return;
    }

    setIsImporting(true);
    try {
      const result = (await window.novelTool.imports.previewTxt({ filePath: filePath.trim() })) as TxtPreviewResult;
      setSelectedFileType('txt');
      setTxtPreview(result);
      setProjectName(result.preview.suggestedProjectName);
      setBaseDirectory(guessBaseDirectory(result.preview.sourceFilePath));
      setStatus(`已读取 ${result.preview.fileName}：${result.preview.chapters.length} 章`);
    } catch (error) {
      setTxtPreview(null);
      setStatus(userFacingErrorMessage(error, 'TXT 预览失败'));
    } finally {
      setIsImporting(false);
    }
  }

  async function previewEpub(filePath = selectedFilePath) {
    if (!filePath.trim()) {
      setStatus('请先选择 EPUB 文件路径');
      return;
    }
    if (!window.novelTool) {
      setStatus('浏览器预览中不能读取本地 EPUB；请在 Electron 应用中预览导入');
      return;
    }

    setIsImporting(true);
    try {
      const result = (await window.novelTool.imports.previewEpub({ filePath: filePath.trim() })) as EpubPreviewResult;
      setSelectedFileType('epub');
      setTxtPreview(result);
      setProjectName(result.preview.suggestedProjectName);
      setBaseDirectory(guessBaseDirectory(result.preview.sourceFilePath));
      setStatus(`已读取 ${result.preview.fileName}：${result.preview.chapters.length} 章`);
    } catch (error) {
      setTxtPreview(null);
      setStatus(userFacingErrorMessage(error, 'EPUB 预览失败'));
    } finally {
      setIsImporting(false);
    }
  }

  async function commitTxtPreview() {
    if (!txtPreview) {
      setStatus('请先生成章节拆分预览');
      return;
    }
    if (!window.novelTool) {
      setStatus('浏览器预览中不能写入项目；请在 Electron 应用中确认导入');
      return;
    }

    setIsImporting(true);
    try {
      const payload = {
        previewId: txtPreview.previewId,
        projectName,
        baseDirectory,
      };
      const result = (selectedFileType === 'epub'
        ? await window.novelTool.imports.commitEpub(payload)
        : await window.novelTool.imports.commitTxt(payload)) as ImportCommitResult;
      setStatus(`已导入 ${result.chapterCount} 章 / ${result.paragraphCount} 段：${result.projectPath}`);
      skipNextEditorReload.current = true;
      setActivePage('editor');
      await loadEditorProject();
      await refreshReferenceBasket();
      await refreshJobs();
    } catch (error) {
      setStatus(userFacingErrorMessage(error, selectedFileType === 'epub' ? 'EPUB 导入失败' : 'TXT 导入失败'));
    } finally {
      setIsImporting(false);
    }
  }

  async function openExistingProject() {
    if (!window.novelTool) {
      setStatus('桌面应用中会打开项目选择器；浏览器预览不能读取本地项目。');
      return;
    }

    setIsImporting(true);
    try {
      const result = (await window.novelTool.project.pickExisting()) as ExistingProjectPickResult;
      if (result.canceled) {
        setStatus('已取消打开项目');
        return;
      }
      setProjectName(result.name);
      setBaseDirectory(guessBaseDirectory(result.projectPath));
      setStatus(`已打开项目：${result.projectPath}`);
      skipNextEditorReload.current = true;
      setActivePage('editor');
      await loadEditorProject();
      await refreshReferenceBasket();
      await refreshJobs();
    } catch (error) {
      setStatus(userFacingErrorMessage(error, '打开项目失败'));
    } finally {
      setIsImporting(false);
    }
  }

  async function refreshProviderStatus() {
    if (!window.novelTool) {
      setProviderStatus(null);
      return;
    }
    try {
      const result = (await window.novelTool.providers.status()) as ProviderStatusResult;
      setProviderStatus(result);
      setActiveProvider(result.activeProvider);
    } catch {
      setProviderStatus(null);
      setActiveProvider(null);
    }
  }

  async function activateProvider(providerId: 'deepseek' | 'openrouter') {
    if (!window.novelTool) {
      setActiveProvider(providerId);
      setStatus('浏览器预览中只展示交互状态，桌面应用会写入本机设置');
      return;
    }

    const result = (await window.novelTool.providers.setActive({ providerId })) as {
      activeProvider: 'deepseek' | 'openrouter';
    };
    setActiveProvider(result.activeProvider);
    await refreshProviderStatus();
    setStatus(`当前激活：${result.activeProvider === 'deepseek' ? 'DeepSeek' : 'OpenRouter'}`);
  }

  async function saveProviderKey(providerId: 'deepseek' | 'openrouter' | null, apiKey: string): Promise<boolean> {
    if (!providerId) {
      setStatus('请先选择一个激活供应商');
      return false;
    }
    if (!apiKey.trim()) {
      setStatus('请先输入 API Key');
      return false;
    }
    if (!window.novelTool) {
      setStatus('浏览器预览不会保存 API Key；桌面应用会写入系统安全存储');
      return false;
    }

    try {
      const result = (await window.novelTool.providers.saveKey({
        providerId,
        apiKey: apiKey.trim(),
      })) as IpcResponse<'providers.saveKey'>;
      setActiveProvider(result.activeProvider);
      await refreshProviderStatus();
      setStatus(`已保存 ${providerId === 'deepseek' ? 'DeepSeek' : 'OpenRouter'} API Key 到系统安全存储`);
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'API Key 保存失败');
      return false;
    }
  }

  async function testProviderConnection(providerId: 'deepseek' | 'openrouter' | null) {
    if (!providerId) {
      setStatus('请先选择一个激活供应商');
      return;
    }
    if (!window.novelTool) {
      setStatus('浏览器预览不会连接模型；桌面应用会测试当前激活供应商');
      return;
    }

    setStatus('正在测试模型连接...');
    try {
      const result = (await window.novelTool.providers.testConnection({ providerId })) as IpcResponse<'providers.testConnection'>;
      await refreshProviderStatus();
      setStatus(`模型连接成功：${providerId === 'deepseek' ? 'DeepSeek' : 'OpenRouter'} / ${result.model}`);
    } catch (error) {
      await refreshProviderStatus();
      setStatus(error instanceof Error ? error.message : '模型连接测试失败');
    }
  }

  async function deleteProviderKey(providerId: 'deepseek' | 'openrouter' | null) {
    if (!providerId) {
      setStatus('请先选择要删除密钥的供应商');
      return;
    }
    const providerLabel = providerId === 'deepseek' ? 'DeepSeek' : 'OpenRouter';
    if (!window.confirm(`删除本机保存的 ${providerLabel} API Key？删除后需要重新填写才能运行模型任务。`)) {
      setStatus('已取消删除密钥');
      return;
    }
    if (!window.novelTool) {
      setStatus('浏览器预览不会删除本机密钥；桌面应用会从系统安全存储移除。');
      return;
    }

    try {
      const result = (await window.novelTool.providers.deleteKey({ providerId })) as IpcResponse<'providers.deleteKey'>;
      setActiveProvider(result.activeProvider);
      await refreshProviderStatus();
      setStatus(`已删除 ${providerLabel} API Key`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'API Key 删除失败');
    }
  }

  async function loadTaskModelProfile() {
    if (!window.novelTool) {
      setTaskModelProfile(defaultTaskModelProfile);
      return;
    }

    try {
      const config = (await window.novelTool.config.get()) as ProjectConfigResult;
      setTaskModelProfile(config.taskModelProfile);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '任务模型设置读取失败');
    }
  }

  async function updateTaskModelSetting(task: TaskType, setting: TaskModelSetting) {
    setTaskModelProfile((profile) => ({
      ...profile,
      [task]: setting,
    }));

    const taskLabel = settingsTaskRows.find((row) => row.task === task)?.label ?? task;
    if (!window.novelTool) {
      setStatus(`浏览器预览只更新界面状态；桌面应用会保存 ${taskLabel} 的任务模型设置`);
      return;
    }

    try {
      const profile = (await window.novelTool.config.updateTaskModelProfile({
        task,
        setting,
      })) as TaskModelProfile;
      setTaskModelProfile(profile);
      setStatus(`已保存 ${taskLabel} 的任务模型设置`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '任务模型设置保存失败');
    }
  }

  async function restoreRecommendedTaskModelProfile() {
    setTaskModelProfile(defaultTaskModelProfile);
    if (!window.novelTool) {
      setStatus('已恢复推荐模型配置；浏览器预览不会写入项目文件。');
      return;
    }
    try {
      let profile: TaskModelProfile = defaultTaskModelProfile;
      for (const row of settingsTaskRows) {
        profile = (await window.novelTool.config.updateTaskModelProfile({
          task: row.task,
          setting: defaultTaskModelProfile[row.task],
        })) as TaskModelProfile;
      }
      setTaskModelProfile(profile);
      setStatus('已恢复当前项目的推荐模型配置');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '恢复推荐模型配置失败');
    }
  }

  async function loadEditorProject() {
    if (!window.novelTool) {
      const demoChapter: EditableChapterResult = {
        id: 'demo-chapter',
        title: '窗下旧约',
        index: 0,
        paragraphs: sampleParagraphs.map((text, index) => ({
          id: `demo-para-${index + 1}`,
          index,
          friendlyLabel: `第 ${index + 1} 段`,
          text,
          version: 1,
        })),
      };
      setChapters([{ id: demoChapter.id, title: demoChapter.title, index: 0, wordCount: 0, paragraphCount: 3 }]);
      setActiveChapter(demoChapter);
      setSelectedParagraphId(demoChapter.paragraphs[0]?.id ?? null);
      setReferenceBasket([]);
      setEditorStatus('浏览器预览使用演示段落；桌面应用会读取当前项目数据库');
      return;
    }

    setIsEditorLoading(true);
    try {
      const chapterList = (await window.novelTool.chapters.list()) as ChapterListResult;
      setChapters(chapterList);
      if (chapterList.length === 0) {
        setActiveChapter(null);
        setSelectedParagraphId(null);
        setEditorStatus('当前项目还没有正文，请先导入 TXT 或 EPUB');
        return;
      }
      const initialChapterId = pickInitialChapterId(chapterList);
      if (!initialChapterId) {
        setActiveChapter(null);
        setSelectedParagraphId(null);
        setEditorStatus('当前项目还没有正文，请先导入 TXT 或 EPUB');
        return;
      }
      await loadChapter(initialChapterId);
      setEditorStatus(`已载入 ${chapterList.length} 章`);
    } catch (error) {
      setChapters([]);
      setActiveChapter(null);
      setSelectedParagraphId(null);
      const message = userFacingErrorMessage(error, '章节载入失败');
      setEditorStatus(
        message.includes('请先新建或打开') ? '还没有打开项目。请先新建本地项目或打开已有项目。' : message
      );
      setStatus(message.includes('请先新建或打开') ? '还没有打开项目' : message);
    } finally {
      setIsEditorLoading(false);
    }
  }

  async function loadChapter(chapterId: string) {
    if (!window.novelTool) {
      return;
    }
    const chapter = (await window.novelTool.chapters.get({ chapterId })) as EditableChapterResult;
    setActiveChapter(chapter);
    setSelectedParagraphId(chapter.paragraphs[0]?.id ?? null);
    setDirtyParagraphIds([]);
    setHighlightedParagraphId(null);
  }

  async function loadRevisionHistory(paragraphId = selectedParagraphId) {
    setPendingRestoreId(null);
    if (!paragraphId) {
      setRevisionItems([]);
      setRevisionStatus('选择段落后显示版本历史');
      return;
    }
    if (!window.novelTool) {
      setRevisionItems([]);
      setRevisionStatus('浏览器预览不读取本地版本历史');
      return;
    }

    try {
      const result = (await window.novelTool.revisions.list({
        scopeType: 'paragraph',
        scopeId: paragraphId,
      })) as RevisionListResult;
      setRevisionItems(result);
      setRevisionStatus(result.length > 0 ? `找到 ${result.length} 条可恢复记录` : '当前段落还没有修改记录');
    } catch (error) {
      setRevisionItems([]);
      setRevisionStatus(error instanceof Error ? error.message : '版本历史读取失败');
    }
  }

  function updateLocalParagraph(paragraphId: string, text: string) {
    setDirtyParagraphIds((ids) => markParagraphDirty(ids, paragraphId));
    setEditorStatus(hasDesktopApi ? '有未保存改动，稍后自动保存' : '浏览器预览不会写入正文；桌面应用会自动保存');
    setActiveChapter((chapter) =>
      chapter
        ? {
            ...chapter,
            paragraphs: chapter.paragraphs.map((paragraph) =>
              paragraph.id === paragraphId ? { ...paragraph, text } : paragraph
            ),
          }
        : chapter
    );
  }

  async function saveParagraph(paragraphId: string, text: string, changeReason = 'autosave') {
    if (!window.novelTool) {
      setEditorStatus('浏览器预览不会写入正文；桌面应用会自动保存');
      return;
    }

    setEditorStatus('保存中...');
    try {
      const result = (await window.novelTool.paragraphs.update({
        paragraphId,
        text,
        changeReason,
      })) as ParagraphUpdateResult;
      setDirtyParagraphIds((ids) => clearParagraphDirty(ids, paragraphId));
      setActiveChapter((chapter) =>
        chapter
          ? {
              ...chapter,
              paragraphs: chapter.paragraphs.map((paragraph) =>
                paragraph.id === paragraphId ? { ...paragraph, version: result.version } : paragraph
              ),
            }
          : chapter
      );
      setEditorStatus(result.changed ? `已自动保存到版本 ${result.version}` : '内容未变化');
      void window.novelTool.chapters.list().then((next) => setChapters(next as ChapterListResult));
      if (result.changed) {
        void loadRevisionHistory(paragraphId);
      }
      void refreshJobs();
    } catch (error) {
      setEditorStatus(error instanceof Error ? error.message : '段落保存失败');
    }
  }

  async function restoreRevisionInEditor() {
    if (!pendingRestoreId) {
      setRevisionStatus('请先选择一条版本记录');
      return;
    }
    if (!window.novelTool) {
      setRevisionStatus('浏览器预览不会恢复本地版本；请在 Electron 应用中操作');
      return;
    }
    if (!activeChapter) {
      setRevisionStatus('当前没有可恢复的章节');
      return;
    }

    setRevisionStatus('正在恢复版本...');
    try {
      const result = (await window.novelTool.revisions.restore({ revisionId: pendingRestoreId })) as RevisionRestoreResult;
      await loadChapter(activeChapter.id);
      setSelectedParagraphId(result.paragraphId);
      setDirtyParagraphIds([]);
      setQuickActionScope(null);
      setContextMenu(null);
      await loadRevisionHistory(result.paragraphId);
      setEditorStatus(result.changed ? `已恢复到版本 ${result.version}` : '正文已经是该版本内容');
      setStatus(result.changed ? `已恢复段落到版本 ${result.version}` : '正文已经是该版本内容');
      void refreshJobs();
    } catch (error) {
      setRevisionStatus(error instanceof Error ? error.message : '版本恢复失败');
    }
  }

  async function refreshJobs() {
    if (!window.novelTool) {
      setJobs([]);
      return;
    }
    try {
      const result = (await window.novelTool.jobs.subscribe()) as JobsSnapshot;
      setJobs(result.jobs);
    } catch {
      setJobs([]);
    }
  }

  async function refreshReferenceBasket() {
    if (!window.novelTool) {
      setReferenceBasket([]);
      return;
    }
    try {
      const config = (await window.novelTool.config.get()) as IpcResponse<'config.get'>;
      const paragraphIds = config.contextReferences.paragraphIds;
      if (paragraphIds.length === 0) {
        setReferenceBasket([]);
        return;
      }
      const result = (await window.novelTool.search.addToContext({
        mode: 'replace',
        paragraphIds,
      })) as SearchReferencesResult;
      setReferenceBasket(result.references);
    } catch (error) {
      setReferenceBasket([]);
      setSearchStatus(error instanceof Error ? error.message : '引用篮读取失败');
    }
  }

  async function runSearch() {
    if (!searchQuery.trim()) {
      setSearchStatus('请输入搜索关键词');
      return;
    }
    if (!window.novelTool) {
      setSearchStatus('浏览器预览中不能读取本地索引；桌面应用会搜索当前项目正文');
      return;
    }

    setSearchStatus('搜索中...');
    try {
      const result = (await window.novelTool.search.query({
        query: searchQuery.trim(),
        limit: 20,
      })) as SearchResult;
      setSearchResult(result);
      setSearchStatus(`找到 ${result.results.length} 条结果`);
    } catch (error) {
      setSearchResult(null);
      setSearchStatus(error instanceof Error ? error.message : '搜索失败');
    }
  }

  async function addSearchResultToContext(paragraphId: string) {
    if (!window.novelTool) {
      setSearchStatus('浏览器预览中不能加入本地上下文；桌面应用会把该段落交给后续对话/检查任务');
      return;
    }

    try {
      const result = (await window.novelTool.search.addToContext({
        mode: 'add',
        paragraphIds: [paragraphId],
      })) as SearchReferencesResult;
      const reference = result.references.find((item) => item.paragraphId === paragraphId);
      setReferenceBasket(result.references);
      setSearchStatus(reference ? `已加入引用：${reference.friendlyLocation}` : '没有可加入的引用');
    } catch (error) {
      setSearchStatus(error instanceof Error ? error.message : '加入引用失败');
    }
  }

  async function replaceReferenceBasket(paragraphIds: string[]) {
    if (!window.novelTool) {
      setSearchStatus('浏览器预览不能修改引用篮；桌面应用会保存到当前项目');
      return;
    }
    try {
      const result = (await window.novelTool.search.addToContext({
        mode: paragraphIds.length === 0 ? 'clear' : 'replace',
        paragraphIds,
      })) as SearchReferencesResult;
      setReferenceBasket(result.references);
      setSearchStatus(result.references.length > 0 ? `当前引用 ${result.references.length} 条` : '引用篮已清空');
    } catch (error) {
      setSearchStatus(error instanceof Error ? error.message : '引用篮更新失败');
    }
  }

  function sendReferenceBasketToPage(target: 'chat' | 'continuity' | 'proofread') {
    if (referenceBasket.length === 0) {
      setSearchStatus('请先把搜索结果加入引用');
      return;
    }
    const label = target === 'chat' ? '问一下' : target === 'proofread' ? '校对' : '检查矛盾';
    const routeStatus = buildReferenceRouteStatus(referenceBasket.length, label);
    if (target === 'chat') {
      setAgentExplicitReferences(referenceBasket);
    }
    setActivePage(target);
    setStatus(routeStatus);
  }

  function showPendingFeatureStatus(featureName: string) {
    setStatus(buildPendingFeatureStatus(featureName));
  }

  async function runAiTaskPreflight(page: PageId, execute = false) {
    if (!isAiTaskPage(page)) {
      showPendingFeatureStatus(pageTitle);
      return;
    }
    if (!window.novelTool) {
      setAiPreflight(null);
      setAiTaskStatus('浏览器预览不能读取本地项目上下文；桌面应用会生成真实上下文预检。');
      setStatus('浏览器预览不能读取本地项目上下文；桌面应用会生成真实上下文预检。');
      return;
    }
    if (execute && page !== 'continuity' && !canRunConnectedModelTask(providerStatus)) {
      const message = modelGateMessage(providerStatus, hasDesktopApi) ?? '请先连接当前模型供应商。';
      setAiTaskStatus(message);
      setStatus(message);
      return;
    }

    const selectedParagraph = activeChapter?.paragraphs.find((paragraph) => paragraph.id === selectedParagraphId);
    const scopeLabel = quickActionScope
      ? `${activeChapter?.title ?? '当前章节'} / ${quickActionScope.scopeLabel}`
      : selectedParagraph && activeChapter
        ? `${activeChapter.title} / ${selectedParagraph.friendlyLabel}`
        : referenceBasket.length > 0
          ? `当前引用 ${referenceBasket.length} 条`
          : '当前任务';
    const scope: Record<string, unknown> = {
      scopeLabel,
      currentChapterId: activeChapter?.id,
      referenceParagraphIds: referenceBasket.map((reference) => reference.paragraphId),
    };
    if (quickActionScope) {
      scope.anchorParagraphId = quickActionScope.paragraphId;
      scope.selectedText = quickActionScope.selectedText;
    } else if (selectedParagraph) {
      scope.anchorParagraphId = selectedParagraph.id;
      scope.selectedText = selectedParagraph.text;
    }

    setAiTaskStatus('正在准备上下文...');
    setStatus('正在准备上下文...');
    try {
      const result = (await window.novelTool.ai.runTask({
        task: taskTypeForPage(page),
        scope,
        input: {
          userInstruction: taskInstruction,
          execute,
          ...(page === 'polish'
            ? {
                strength: polishStrength,
                focus: polishFocus,
                forbiddenChanges: polishForbiddenChanges,
              }
            : {}),
          ...(page === 'expand'
            ? {
                previousContext: expandPreviousContext,
                nextBeats: expandNextBeats,
                focusDetails: expandFocusDetails,
                forbiddenChanges: expandForbiddenChanges,
                pov: expandPov,
                targetLength: expandTargetLength,
                styleStrength: expandStyleStrength,
              }
            : {}),
        },
      })) as AiTaskPreflightResult;
      setAiPreflight(result);
	      setAiTaskStatus(
	        result.status === 'candidate_ready'
	          ? result.candidate.kind === 'polish'
	            ? '已生成润色候选，确认后才会写入正文。'
	            : '已生成扩写草稿，确认后才会插入正文。'
	          : result.status === 'issues_ready'
	            ? page === 'continuity'
	              ? `已检查 ${result.checkedParagraphCount} 条事实，生成 ${result.issues.length} 张矛盾证据卡。`
	              : `完整校对 ${result.checkedParagraphCount} 段，生成 ${result.issues.length} 条问题卡。`
	            : `已准备上下文：${result.context.preflightSummary}`
	      );
	      setStatus(
	        result.status === 'candidate_ready'
	          ? result.candidate.kind === 'polish'
	            ? '润色候选已生成，等待确认。'
	            : '扩写草稿已生成，等待确认。'
	          : result.status === 'issues_ready'
	            ? page === 'continuity'
	              ? `矛盾检查完成：${result.issues.length} 张证据卡。`
	              : `完整校对完成：${result.issues.length} 条问题卡。`
	            : '上下文预检完成。'
	      );
	      if (result.status === 'issues_ready') {
	        setProofreadIssues(result.issues);
	        setIssuePanelStatus(
	          page === 'continuity'
	            ? result.issues.length > 0
	              ? `矛盾检查完成：${result.issues.length} 张证据卡`
	              : '矛盾检查完成：没有发现事实冲突'
	            : result.issues.length > 0
	              ? `完整校对完成：${result.issues.length} 条问题卡`
	              : '完整校对完成：没有发现问题'
	        );
	      }
	      await refreshJobs();
	    } catch (error) {
      setAiPreflight(null);
      const message = userFacingErrorMessage(error, 'AI 任务预检失败');
      setAiTaskStatus(message);
      setStatus(message);
    }
  }

  async function acceptRevisionCandidate(revisionId: string) {
    if (!window.novelTool) {
      setAiTaskStatus('浏览器预览不能写入正文；桌面应用会在确认后应用候选修改。');
      return;
    }
      setAiTaskStatus('正在应用候选...');
    try {
      const result = (await window.novelTool.revisions.acceptCandidate({ revisionId })) as CandidateAcceptResult;
      if (activeChapter) {
        await loadChapter(activeChapter.id);
      }
      const selectedId = 'insertedParagraphIds' in result ? result.insertedParagraphIds[0] : result.paragraphId;
      setSelectedParagraphId(selectedId);
      setAiPreflight(null);
      setAiTaskStatus(
        'insertedParagraphIds' in result
          ? `已插入 ${result.insertedCount} 段扩写草稿`
          : `已应用润色候选，当前段落版本 ${result.version}`
      );
      setStatus(
        'insertedParagraphIds' in result
          ? `已插入 ${result.insertedCount} 段扩写草稿`
          : `已应用润色候选，当前段落版本 ${result.version}`
      );
      await loadRevisionHistory(selectedId);
      await refreshJobs();
	    } catch (error) {
	      const message = userFacingErrorMessage(error, '候选应用失败');
	      setAiTaskStatus(message);
	      setStatus(message);
	    }
	  }

	  async function loadProofreadIssues(paragraphId = selectedParagraphId) {
	    if (activePage !== 'proofread') {
	      return;
	    }
	    if (!window.novelTool) {
	      setProofreadIssues([]);
	      setIssuePanelStatus('浏览器预览不能读取本地问题卡；桌面应用会显示当前段落的校对结果');
	      return;
	    }
	    try {
	      const result = (await window.novelTool.issues.list({
	        ...(paragraphId ? { currentParagraphId: paragraphId } : {}),
	        status: 'open',
	        limit: 50,
	      })) as IpcResponse<'issues.list'>;
	      setProofreadIssues(result.issues);
	      setIssuePanelStatus(result.issues.length > 0 ? `当前有 ${result.issues.length} 条待处理问题` : '当前范围没有待处理问题');
	    } catch (error) {
	      setProofreadIssues([]);
	      setIssuePanelStatus(error instanceof Error ? error.message : '问题卡读取失败');
	    }
	  }

	  async function updateProofreadIssueStatus(issueId: string, status: IssueCard['status']) {
	    if (!window.novelTool) {
	      setIssuePanelStatus('浏览器预览不能更新问题卡；桌面应用会写入本地数据库');
	      return;
	    }
	    try {
	      const updated = (await window.novelTool.issues.updateStatus({ issueId, status })) as IssueCard;
	      setProofreadIssues((issues) => issues.map((issue) => (issue.id === issueId ? updated : issue)));
	      setIssuePanelStatus(`已标记：${status}`);
	    } catch (error) {
	      setIssuePanelStatus(error instanceof Error ? error.message : '问题卡状态更新失败');
	    }
	  }

	  async function runLocalProofread() {
	    const paragraphIds = [
	      ...(quickActionScope ? [quickActionScope.paragraphId] : []),
	      ...(!quickActionScope && selectedParagraphId ? [selectedParagraphId] : []),
	      ...(!quickActionScope && !selectedParagraphId ? referenceBasket.map((reference) => reference.paragraphId) : []),
	    ];
	    const uniqueParagraphIds = [...new Set(paragraphIds)];
	    if (uniqueParagraphIds.length === 0) {
	      setIssuePanelStatus('请先在正文选择段落，或从搜索页加入引用。');
	      setStatus('请先在正文选择段落，或从搜索页加入引用。');
	      return;
	    }
	    if (!window.novelTool) {
	      setIssuePanelStatus('浏览器预览不能读取本地正文；桌面应用会运行本地预筛。');
	      setStatus('浏览器预览不能读取本地正文；桌面应用会运行本地预筛。');
	      return;
	    }
	    setIssuePanelStatus('正在本地预筛...');
	    setStatus('正在本地预筛...');
	    try {
	      const result = (await window.novelTool.proofread.runRules({ paragraphIds: uniqueParagraphIds })) as IpcResponse<'proofread.runRules'>;
	      setProofreadIssues(result.issues);
	      setIssuePanelStatus(
	        result.issues.length > 0
	          ? `本地预筛 ${result.checkedParagraphCount} 段，发现 ${result.issues.length} 条规则问题`
	          : `本地预筛 ${result.checkedParagraphCount} 段，没有发现规则问题`
	      );
	      setStatus(result.issues.length > 0 ? `本地预筛完成：${result.issues.length} 条问题卡。` : '本地预筛完成：没有发现规则问题。');
	    } catch (error) {
	      const message = userFacingErrorMessage(error, '本地预筛失败');
	      setIssuePanelStatus(message);
	      setStatus(message);
	    }
	  }

  async function loadMemoryCards() {
    if (!window.novelTool) {
      setMemoryCards([]);
      setMemoryStatus('浏览器预览不能读取本地记忆库；桌面应用会显示项目记忆卡。');
      return;
    }
    try {
      const result = (await window.novelTool.memory.list()) as MemoryListResult;
      setMemoryCards(result.cards);
      setMemoryStatus(result.cards.length > 0 ? `已读取 ${result.cards.length} 条记忆` : '当前项目还没有记忆卡');
    } catch (error) {
      setMemoryCards([]);
      setMemoryStatus(error instanceof Error ? error.message : '记忆库读取失败');
    }
  }

  async function loadCanonRecords() {
    if (!window.novelTool) {
      setCanonRecords([]);
      setCanonSources([]);
      setCanonStatus('浏览器预览不能读取本地设定；桌面应用会显示项目全局设定。');
      return;
    }
    try {
      const result = (await window.novelTool.canon.list()) as CanonListResult;
      setCanonRecords(result.records);
      setCanonSources(result.sources);
      setCanonStatus(result.records.length > 0 ? `已读取 ${result.records.length} 条全局设定` : '当前项目还没有生成全局设定文档');
    } catch (error) {
      setCanonRecords([]);
      setCanonSources([]);
      setCanonStatus(userFacingErrorMessage(error, '全局设定读取失败'));
    }
  }

  async function confirmFirstMemoryCard() {
    const target = memoryCards.find((card) => card.status !== 'user_confirmed');
    if (!target) {
      setMemoryStatus(memoryCards.length > 0 ? '当前显示的记忆都已确认' : '当前没有可确认的记忆');
      return;
    }
    if (!window.novelTool) {
      setMemoryStatus('浏览器预览不能更新本地记忆；桌面应用会写入项目数据库。');
      return;
    }
    try {
      const updated = (await window.novelTool.memory.updateCard({
        cardId: target.id,
        changes: { status: 'user_confirmed' },
      })) as MemoryCard;
      setMemoryCards((cards) => cards.map((card) => (card.id === updated.id ? updated : card)));
      setMemoryStatus(`已确认记忆：${updated.title}`);
      setStatus(`已确认记忆：${updated.title}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '记忆确认失败';
      setMemoryStatus(message);
      setStatus(message);
    }
  }

  async function analyzeProjectCanonDocs() {
    if (!window.novelTool) {
      setCanonStatus('浏览器预览不能分析本地项目；桌面应用会生成项目全局设定。');
      setStatus('浏览器预览不能分析本地项目；桌面应用会生成项目全局设定。');
      return;
    }
    setCanonStatus('正在分析项目并生成全局设定...');
    setStatus('正在分析项目并生成全局设定...');
    try {
      const result = (await window.novelTool.canon.analyzeProject()) as CanonAnalyzeResult;
      setCanonStatus(`已生成 ${result.fileNames.length} 个设定页面，解析 ${result.recordCount} 条设定记录`);
      setStatus(`项目分析完成：${result.fileNames.length} 个设定页面`);
      await loadCanonRecords();
    } catch (error) {
      const message = userFacingErrorMessage(error, '项目分析失败');
      setCanonStatus(message);
      setStatus(message);
    }
  }

  async function loadTimeline() {
    if (!window.novelTool) {
      setTimelineResult(null);
      setTimelineStatus('浏览器预览不能读取本地时间线；桌面应用会显示项目事件。');
      return;
    }
    try {
      const result = (await window.novelTool.timeline.query({})) as TimelineQueryResult;
      setTimelineResult(result);
      setTimelineStatus(result.nodes.length > 0 ? `已读取 ${result.nodes.length} 个事件节点` : '当前项目还没有时间线事件');
    } catch (error) {
      setTimelineResult(null);
      setTimelineStatus(userFacingErrorMessage(error, '时间线读取失败'));
    }
  }

  async function analyzeProjectTimeline() {
    if (!window.novelTool) {
      setTimelineStatus('浏览器预览不能分析本地时间线；桌面应用会生成项目事件节点。');
      setStatus('浏览器预览不能分析本地时间线；桌面应用会生成项目事件节点。');
      return;
    }
    setTimelineStatus('正在分析时间线...');
    setStatus('正在分析时间线...');
    try {
      const result = (await window.novelTool.timeline.analyze({})) as TimelineAnalyzeResult;
      setTimelineResult(result);
      const skippedLabel = result.skippedCount > 0 ? `，跳过 ${result.skippedCount} 条无法定位引用` : '';
      const summary = `时间线分析完成：新增 ${result.createdCount} 个，更新 ${result.updatedCount} 个${skippedLabel}`;
      setTimelineStatus(result.warnings[0] ? `${summary}。${result.warnings[0]}` : summary);
      setStatus(result.warnings[0] ? `${summary}：${result.warnings[0]}` : `时间线分析完成：${result.nodes.length} 个事件节点`);
    } catch (error) {
      const message = userFacingErrorMessage(error, '时间线分析失败');
      setTimelineResult(null);
      setTimelineStatus(message);
      setStatus(message);
    }
  }

  async function refreshExportPreview(format = exportFormat) {
    if (!window.novelTool) {
      setExportPreview(null);
      setExportStatus('浏览器预览不能读取本地项目；桌面应用会生成真实导出预览。');
      return;
    }
    try {
      const result = (await window.novelTool.exports.preview({ format })) as ExportPreviewResult;
      setExportPreview(result);
      setExportOutputPath((current) => current || result.defaultOutputPath);
      setExportStatus(`可导出 ${result.chapterCount} 章 / ${result.characterCount} 字符`);
    } catch (error) {
      setExportPreview(null);
      setExportStatus(error instanceof Error ? error.message : '导出预览失败');
    }
  }

  async function runCurrentExport() {
    const outputPath = exportOutputPath.trim() || exportPreview?.defaultOutputPath;
    if (!outputPath) {
      setExportStatus('请先生成导出预览或填写导出路径');
      return;
    }
    if (!window.novelTool) {
      setExportStatus('浏览器预览不能写入导出文件；桌面应用会写入项目 exports 目录。');
      setStatus('浏览器预览不能写入导出文件；桌面应用会写入项目 exports 目录。');
      return;
    }
    setExportStatus('正在导出...');
    setStatus('正在导出...');
    try {
      const result = (await window.novelTool.exports.run({
        format: exportFormat,
        outputPath,
      })) as ExportRunResult;
      setExportStatus(`已导出 ${result.chapterCount} 章：${result.artifactPath}`);
      setStatus(`已导出：${result.artifactPath}`);
      await refreshJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : '导出失败';
      setExportStatus(message);
      setStatus(message);
    }
  }

	  async function runAgentChat() {
	    if (!taskInstruction.trim()) {
	      setChatAgentStatus('请先写下要问 Agent 的问题。');
	      setStatus('请先写下要问 Agent 的问题。');
	      return;
	    }
	    if (!window.novelTool) {
	      setChatAgentResult(null);
	      setChatAgentStatus('浏览器预览不能调用模型；桌面应用会运行真实 Agent。');
	      setStatus('浏览器预览不能调用模型；桌面应用会运行真实 Agent。');
	      return;
	    }
	    if (!canRunConnectedModelTask(providerStatus)) {
	      const message = modelGateMessage(providerStatus, hasDesktopApi) ?? '请先连接当前模型供应商。';
	      setChatAgentStatus(message);
	      setStatus(message);
	      return;
	    }
	    const selectedParagraph = activeChapter?.paragraphs.find((paragraph) => paragraph.id === selectedParagraphId);
	    const explicitScopeReference = agentExplicitReferences.find((reference) => reference.paragraphId === quickActionScope?.paragraphId);
	    const currentParagraphId = explicitScopeReference?.paragraphId;
	    const selectedText = currentParagraphId ? quickActionScope?.selectedText ?? selectedParagraph?.text : undefined;
	    const referenceIds = [
	      ...referenceBasket.map((reference) => reference.paragraphId),
	      ...agentExplicitReferences.map((reference) => reference.paragraphId),
	    ].filter((paragraphId, index, all) => paragraphId && all.indexOf(paragraphId) === index);
	    setChatAgentStatus('Agent 正在读取上下文...');
	    setStatus('Agent 正在读取上下文...');
	    try {
	      const result = (await window.novelTool.chat.send({
	        message: buildAgentMessageWithInstruction(taskInstruction.trim(), agentInstructionPreset),
	        mode: agentBackendModeForUiMode(agentMode),
	        ...(currentParagraphId ? { currentParagraphId } : {}),
	        selectedParagraphIds: currentParagraphId ? [currentParagraphId] : [],
	        ...(selectedText ? { selectedText } : {}),
	        references: referenceIds,
	      })) as ChatAgentResult;
	      setChatAgentResult(result);
	      const nextStatus =
	        result.status === 'completed'
	          ? `Agent 完成：调用 ${result.toolResults.length} 个工具`
	          : result.error ?? `Agent 状态：${result.status}`;
	      setChatAgentStatus(nextStatus);
	      setStatus(nextStatus);
	    } catch (error) {
	      const message = userFacingErrorMessage(error, 'Agent 运行失败');
	      setChatAgentResult(null);
	      setChatAgentStatus(message);
	      setStatus(message);
	    }
	  }

  async function applyAgentArtifact(artifactId: string) {
    if (!window.novelTool) {
      setChatAgentStatus('浏览器预览不能应用 Agent 候选；桌面应用会在确认后写入。');
      setStatus('浏览器预览不能应用 Agent 候选；桌面应用会在确认后写入。');
      return;
    }
    setChatAgentStatus('正在应用 Agent 候选...');
    setStatus('正在应用 Agent 候选...');
    try {
      const result = (await window.novelTool.agent.applyArtifact({ artifactId })) as AgentArtifactDecisionResult;
      setChatAgentResult((current) =>
        current ? { ...current, artifacts: current.artifacts.filter((artifact) => artifact.id !== artifactId) } : current
      );
      if (activeChapter && result.appliedResult && typeof result.appliedResult === 'object') {
        const applied = result.appliedResult as Record<string, unknown>;
        await loadChapter(activeChapter.id);
        if (typeof applied.paragraphId === 'string') {
          setSelectedParagraphId(applied.paragraphId);
          await loadRevisionHistory(applied.paragraphId);
        } else if (Array.isArray(applied.insertedParagraphIds) && typeof applied.insertedParagraphIds[0] === 'string') {
          setSelectedParagraphId(applied.insertedParagraphIds[0]);
        }
      }
      const message =
        result.appliedType === 'polish_revision'
          ? '已应用 Agent 润色候选，正文已更新。'
          : result.appliedType === 'expansion_draft'
            ? '已插入 Agent 扩写草稿。'
            : result.appliedType === 'issue_action'
              ? '已应用 Agent 问题处理候选。'
              : 'Agent 候选已确认。';
      setChatAgentStatus(message);
      setStatus(message);
      await refreshJobs();
    } catch (error) {
      const message = userFacingErrorMessage(error, 'Agent 候选应用失败');
      setChatAgentStatus(message);
      setStatus(message);
    }
  }

  async function rejectAgentArtifact(artifactId: string) {
    if (!window.novelTool) {
      setChatAgentStatus('浏览器预览不能更新 Agent 候选状态；桌面应用会记录拒绝。');
      setStatus('浏览器预览不能更新 Agent 候选状态；桌面应用会记录拒绝。');
      return;
    }
    setChatAgentStatus('正在拒绝 Agent 候选...');
    setStatus('正在拒绝 Agent 候选...');
    try {
      await window.novelTool.agent.rejectArtifact({ artifactId });
      setChatAgentResult((current) =>
        current ? { ...current, artifacts: current.artifacts.filter((artifact) => artifact.id !== artifactId) } : current
      );
      setChatAgentStatus('已拒绝 Agent 候选，项目内容未改变。');
      setStatus('已拒绝 Agent 候选，项目内容未改变。');
    } catch (error) {
      const message = userFacingErrorMessage(error, 'Agent 候选拒绝失败');
      setChatAgentStatus(message);
      setStatus(message);
    }
  }
	
  async function rejectRevisionCandidate(revisionId: string) {
    if (!window.novelTool) {
      setAiTaskStatus('浏览器预览不能更新候选状态；桌面应用会记录拒绝。');
      return;
    }
    try {
      const result = (await window.novelTool.revisions.rejectCandidate({ revisionId })) as CandidateRejectResult;
      setAiPreflight(null);
      setAiTaskStatus(`已拒绝候选：${result.revisionId}`);
      setStatus('已拒绝候选，正文未改变。');
    } catch (error) {
	      const message = error instanceof Error ? error.message : '候选拒绝失败';
	      setAiTaskStatus(message);
	      setStatus(message);
	    }
	  }

  function addAgentReference() {
    const selectedParagraph = activeChapter?.paragraphs.find((paragraph) => paragraph.id === selectedParagraphId);
    const scope = quickActionScope;
    const reference: ReferenceBasket[number] | null = scope
      ? {
          paragraphId: scope.paragraphId,
          chapterId: activeChapter?.id ?? '',
          chapterTitle: activeChapter?.title ?? '',
          friendlyLocation: scope.scopeLabel,
          text: scope.selectedText,
        }
      : selectedParagraph && activeChapter
        ? {
            paragraphId: selectedParagraph.id,
            chapterId: activeChapter.id,
            chapterTitle: activeChapter.title,
            friendlyLocation: `${activeChapter.title} · ${selectedParagraph.friendlyLabel}`,
            text: selectedParagraph.text,
          }
        : null;

    if (!reference) {
      setChatAgentStatus('先在正文中选择一段，或从搜索页加入引用。');
      setStatus('先在正文中选择一段，或从搜索页加入引用。');
      return;
    }

    setAgentExplicitReferences((references) => {
      if (references.some((item) => item.paragraphId === reference.paragraphId)) {
        return references;
      }
      return [...references, reference];
    });
    const token = scope?.kind === 'selection' ? '@当前选段' : '@当前段落';
    setTaskInstruction((value) => (value.includes(token) ? value : `${token} ${value}`.trimStart()));
    setChatAgentStatus(`已添加引用：${reference.friendlyLocation}`);
    setStatus(`已添加 Agent 引用：${reference.friendlyLocation}`);
  }

  function chooseNextAgentInstruction() {
    const order: AgentInstructionPreset[] = ['none', 'evidence', 'continuity', 'polish'];
    const next = order[(order.indexOf(agentInstructionPreset) + 1) % order.length];
    setAgentInstructionPreset(next);
    setChatAgentStatus(`当前指令：${agentInstructionPresets[next].label}`);
    setStatus(`当前 Agent 指令：${agentInstructionPresets[next].label}`);
  }

  async function jumpToSearchResult(result: SearchResultItem) {
    if (!window.novelTool) {
      setStatus('浏览器预览不能读取本地正文；桌面应用会跳转到搜索命中的段落');
      return;
    }

    setEditorStatus(`正在定位 ${result.friendlyLocation}...`);
    try {
      const chapter = (await window.novelTool.chapters.get({ chapterId: result.chapterId })) as EditableChapterResult;
      setActiveChapter(chapter);
      setSelectedParagraphId(result.paragraphId);
      setHighlightedParagraphId(result.paragraphId);
      setQuickActionScope(null);
      setContextMenu(null);
      skipNextEditorReload.current = true;
      setActivePage('editor');
      const jumpStatus = buildSearchJumpStatus(result.friendlyLocation);
      setEditorStatus(jumpStatus);
      setStatus(jumpStatus);
    } catch (error) {
      setEditorStatus(error instanceof Error ? error.message : '搜索结果定位失败');
    }
  }

  const commonPanelProps = {
    activeChapter,
    activeProvider,
    providerStatus,
    activateProvider,
    hasDesktopApi,
    pendingRestoreId,
    quickActionScope,
    referenceBasket,
    revisionItems,
    revisionStatus,
    searchQuery,
    searchResult,
    searchStatus,
    setSearchQuery,
    selectedParagraphId,
    aiPreflight,
    aiTaskStatus,
    chatAgentResult,
    chatAgentStatus,
    proofreadIssues,
    issuePanelStatus,
    taskInstruction,
    setTaskInstruction,
    agentMode,
    setAgentMode,
    agentInstructionPreset,
    setAgentInstructionPreset,
    agentExplicitReferences,
    polishStrength,
    setPolishStrength,
    polishFocus,
    setPolishFocus,
    polishForbiddenChanges,
    setPolishForbiddenChanges,
    expandPreviousContext,
    setExpandPreviousContext,
    expandNextBeats,
    setExpandNextBeats,
    expandFocusDetails,
    setExpandFocusDetails,
    expandForbiddenChanges,
    setExpandForbiddenChanges,
    expandPov,
    setExpandPov,
    expandTargetLength,
    setExpandTargetLength,
    expandStyleStrength,
    setExpandStyleStrength,
    taskModelProfile,
    onAddAgentReference: addAgentReference,
    onChooseAgentInstruction: chooseNextAgentInstruction,
    onAddSearchResult: addSearchResultToContext,
    onCancelRestore: () => {
      setPendingRestoreId(null);
      setRevisionStatus(revisionItems.length > 0 ? `找到 ${revisionItems.length} 条可恢复记录` : '当前段落还没有修改记录');
    },
    onConfirmRestore: restoreRevisionInEditor,
    onJumpSearchResult: jumpToSearchResult,
    onOpenSettings: () => setActivePage('settings'),
    onAcceptCandidate: acceptRevisionCandidate,
    onRejectCandidate: rejectRevisionCandidate,
    onDeleteProviderKey: deleteProviderKey,
    onRestoreRecommendedTaskModelProfile: restoreRecommendedTaskModelProfile,
    onApplyAgentArtifact: applyAgentArtifact,
    onRejectAgentArtifact: rejectAgentArtifact,
    onRunAiTaskPreflight: runAiTaskPreflight,
    onRunAgentChat: runAgentChat,
    onRunSearch: runSearch,
    onSaveProviderKey: saveProviderKey,
    onSendReferencesToPage: sendReferenceBasketToPage,
    onTestProviderConnection: testProviderConnection,
    onUpdateReferenceBasket: replaceReferenceBasket,
    onUpdateTaskModelSetting: updateTaskModelSetting,
    onUpdateProofreadIssueStatus: updateProofreadIssueStatus,
    onRunLocalProofread: runLocalProofread,
    onSelectRestore: (revisionId: string) => {
      setPendingRestoreId(revisionId);
      setRevisionStatus('确认后会把当前段落恢复为该记录的修改前内容，并生成一个新版本。');
    },
  };

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Notebook size={18} weight="duotone" />
          </div>
          <div>
            <strong>文脉工坊</strong>
            <span>{activeChapter ? `《${projectName}》` : '未打开项目'}</span>
          </div>
        </div>
        <div className="global-search">
          <button className="search-shell" onClick={() => setActivePage('search')} type="button">
            <MagnifyingGlass size={15} />
            <span>搜索人物、道具、章节、证据段落</span>
          </button>
        </div>
        <div className="top-actions">
          <span className="pill model-status-pill">
            <span className={`dot ${providerStatus?.activeConnection?.status === 'failed' ? 'danger' : ''}`} />
            <span>{activeModelStatusText(providerStatus, hasDesktopApi)}</span>
          </span>
          <button className="button" onClick={() => setActivePage('settings')} type="button">
            设置
          </button>
          <button className="button" onClick={() => setActivePage('export')} type="button">
            导出
          </button>
        </div>
      </header>

      <nav className="prototype-nav" aria-label={prototypeNavigationLabel}>
        <span>{prototypeNavigationLabel}</span>
        {mainViews.map((view) => (
          <button
            className={primaryViewForPage(activePage) === view.id ? 'active' : ''}
            key={view.id}
            onClick={() => navigateMainView(view.id)}
            type="button"
          >
            {view.label}
          </button>
        ))}
      </nav>

      <section className="app-main" aria-label={navigateLabelFor(primaryViewForPage(activePage))}>
        {activePage === 'start' ? (
          <StartView
            isBusy={isImporting}
            onCreateProject={() => setActivePage('import')}
            onOpenProject={openExistingProject}
          />
        ) : null}

        {activePage === 'import' ? (
          <ImportWorkspace
            baseDirectory={baseDirectory}
            isBusy={isImporting}
            projectName={projectName}
            preview={txtPreview}
            selectedFilePath={selectedFilePath}
            selectedFileType={selectedFileType}
            onBack={() => setActivePage('start')}
            onChoose={chooseManuscript}
            onCommit={commitTxtPreview}
            onPreview={() => (selectedFileType === 'epub' ? previewEpub() : previewTxt())}
          />
        ) : null}

        {isWorkspacePage(activePage) ? (
          <section className={activePage === 'chat' ? 'workspace-view chat-workspace' : 'workspace-view'}>
            <WorkspaceRail activePage={activePage} onSelectPage={setActivePage} />
            <ProjectContextPanel
              activeChapter={activeChapter}
              chapters={chapters}
              quickActionScope={quickActionScope}
              referenceBasket={referenceBasket}
              selectedParagraphId={selectedParagraphId}
              onOpenGlobalPage={setActivePage}
              onSelectChapter={(chapterId) => {
                setEditorStatus('载入章节中...');
                void loadChapter(chapterId).then(() => setEditorStatus('章节已载入'));
              }}
            />
            <section className="workspace-content">
              {activePage === 'editor' ? (
                <EditorColumn
                  activeChapter={activeChapter}
                  editorStatus={editorStatus}
                  isLoading={isEditorLoading}
                  selectedParagraphId={selectedParagraphId}
                  contextMenu={contextMenu}
                  quickActionScope={quickActionScope}
                  highlightedParagraphId={highlightedParagraphId}
                  showSelectionControls
                  onEditParagraph={updateLocalParagraph}
                  onQuickAction={runQuickAction}
                  onSaveParagraph={saveParagraph}
                  onSelectionChange={(scope, menuPosition) => {
                    setQuickActionScope(scope);
                    setContextMenu(menuPosition ?? null);
                  }}
                  onSelectionDismiss={() => {
                    setQuickActionScope(null);
                    setContextMenu(null);
                  }}
                  onSelectParagraph={setSelectedParagraphId}
                />
              ) : (
                <PagePanel activePage={activePage} {...commonPanelProps} />
              )}
            </section>
            <aside className="workspace-inspector">
              {activePage === 'editor' ? (
                <PagePanel activePage={activePage} {...commonPanelProps} />
              ) : (
                <WorkspaceInspector
                  activePage={activePage}
                  activeChapter={activeChapter}
                  agentExplicitReferences={agentExplicitReferences}
                  quickActionScope={quickActionScope}
                  referenceBasket={referenceBasket}
                  selectedParagraphId={selectedParagraphId}
                />
              )}
            </aside>
          </section>
        ) : null}

        {activePage === 'canon' || activePage === 'memory' || activePage === 'timeline' ? (
          <GlobalProjectPage
            activePage={activePage}
            canonRecords={canonRecords}
            canonSources={canonSources}
            canonStatus={canonStatus}
            memoryCards={memoryCards}
            memoryStatus={memoryStatus}
            timelineResult={timelineResult}
            timelineStatus={timelineStatus}
            onConfirmMemory={confirmFirstMemoryCard}
            onAnalyzeProject={analyzeProjectCanonDocs}
            onAnalyzeTimeline={analyzeProjectTimeline}
            onRefreshTimeline={loadTimeline}
          />
        ) : null}

        {activePage === 'settings' ? <PagePanel activePage={activePage} {...commonPanelProps} /> : null}

        {activePage === 'export' ? (
          <ExportPage
            chapterCount={chapters.length}
            exportFormat={exportFormat}
            exportOutputPath={exportOutputPath}
            exportPreview={exportPreview}
            exportStatus={exportStatus}
            setExportFormat={(format) => {
              setExportFormat(format);
              setExportOutputPath('');
            }}
            setExportOutputPath={setExportOutputPath}
            onRefreshPreview={() => refreshExportPreview()}
            onRunExport={runCurrentExport}
          />
        ) : null}
      </section>

      <JobStrip
        cursorStatus={activeChapter?.paragraphs.find((paragraph) => paragraph.id === selectedParagraphId)?.friendlyLabel ?? '-'}
        hasDesktopApi={hasDesktopApi}
        jobs={jobs}
        status={status}
      />
    </main>
  );
}

function JobStrip({
  cursorStatus,
  hasDesktopApi,
  jobs,
  status,
}: {
  cursorStatus: string;
  hasDesktopApi: boolean;
  jobs: JobsSnapshot['jobs'];
  status: string;
}) {
  const latestJob = jobs[0];
  const strip = buildStatusStripModel({
    cursorStatus,
    hasDesktopApi,
    latestJob,
    status,
  });
  return (
    <footer className="bottom-strip">
      <div className="strip-cell">
        <span className="dot" />
        <span>{strip.saveStatus}</span>
        <span className="mono">{strip.cursorStatus}</span>
      </div>
      <div className="strip-cell">
        <span className={strip.queueTone === 'warn' ? 'dot warn' : 'dot'} />
        <span>{strip.queueStatus}</span>
      </div>
      <div className="strip-cell">
        <span className="strip-error">{strip.errorStatus}</span>
      </div>
    </footer>
  );
}

function StartView({
  isBusy,
  onCreateProject,
  onOpenProject,
}: {
  isBusy: boolean;
  onCreateProject: () => void;
  onOpenProject: () => Promise<void>;
}) {
  return (
    <section className="start-view">
      <div className="start-grid">
        <article className="sheet start-card">
          <h1>{startHeroCopy.title}</h1>
          <p>{startHeroCopy.description}</p>
          <div className="primary-actions">
            <button className="big-action" onClick={onCreateProject} type="button">
              <strong>{startHeroCopy.createTitle}</strong>
              <span>{startHeroCopy.createDescription}</span>
            </button>
            <button className="big-action" disabled={isBusy} onClick={onOpenProject} type="button">
              <strong>{startHeroCopy.openTitle}</strong>
              <span>{startHeroCopy.openDescription}</span>
            </button>
          </div>
        </article>
        <aside className="sheet">
          <div className="section">
            <h2>最近项目</h2>
            {recentProjectRows.length > 0 ? (
              <div className="list">
                {recentProjectRows.map((row) => (
                  <button className="row" disabled={isBusy} key={row.title} onClick={onOpenProject} type="button">
                    <div className="row-title">
                      <span>{row.title}</span>
                      <span className={row.badgeKind ? `badge ${row.badgeKind}` : 'badge'}>{row.badge}</span>
                    </div>
                    <div className="row-meta">{row.meta}</div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-copy">{emptyRecentProjectCopy}</p>
            )}
          </div>
          {openReturnCards.length > 0 ? (
            <div className="section">
              <h2>打开后回到</h2>
              <div className="grid-2">
                {openReturnCards.map((card) => (
                  <div className="card subtle" key={card.title}>
                    <strong>{card.title}</strong>
                    <p>{card.description}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function WorkspaceRail({
  activePage,
  onSelectPage,
}: {
  activePage: WorkspacePageId;
  onSelectPage: (page: PageId) => void;
}) {
  return (
    <nav className="rail" aria-label="项目工作页">
      {workspaceViews.map((view) => (
        <button
          className={activePage === view.id ? 'rail-button active' : 'rail-button'}
          key={view.id}
          onClick={() => onSelectPage(view.id)}
          type="button"
        >
          {view.label}
          <span>{view.sublabel}</span>
        </button>
      ))}
    </nav>
  );
}

function ProjectContextPanel({
  activeChapter,
  chapters,
  quickActionScope,
  referenceBasket,
  selectedParagraphId,
  onOpenGlobalPage,
  onSelectChapter,
}: {
  activeChapter: EditableChapterResult | null;
  chapters: ChapterListResult;
  quickActionScope: TextActionScope | null;
  referenceBasket: ReferenceBasket;
  selectedParagraphId: string | null;
  onOpenGlobalPage: (page: PageId) => void;
  onSelectChapter: (chapterId: string) => void;
}) {
  const selectedParagraph = activeChapter?.paragraphs.find((paragraph) => paragraph.id === selectedParagraphId);
  return (
    <aside className="panel project-context">
      <div className="panel-head">
        <div className="panel-title">
          <strong>{activeChapter ? `《${activeChapter.title}》` : '当前项目'}</strong>
          <span>{selectedParagraph ? selectedParagraph.friendlyLabel : '未选择段落'}</span>
        </div>
      </div>
      <div className="panel-body">
        <div className="list">
          {chapters.length > 0 ? (
            chapters.map((chapter) => (
              <button
                className={activeChapter?.id === chapter.id ? 'chapter-row active' : 'chapter-row'}
                key={chapter.id}
                onClick={() => onSelectChapter(chapter.id)}
                type="button"
              >
                <strong>{chapter.title}</strong>
                <span>{chapter.paragraphCount} 段 / {chapter.wordCount} 字</span>
              </button>
            ))
          ) : (
            <p className="empty-copy">还没有章节。先从导入页选择 TXT 或 EPUB。</p>
          )}
        </div>
        <div className="section">
          <h2>当前上下文</h2>
          <div className="card subtle">
            <strong>{quickActionScope ? quickActionScope.scopeLabel : selectedParagraph?.friendlyLabel ?? '未选择'}</strong>
            <p>{quickActionScope?.selectedText ?? selectedParagraph?.text ?? '选择正文后，Agent 和任务会明确显示使用的上下文。'}</p>
            <div className="source-chips">
              {referenceBasket.slice(0, 3).map((reference) => (
                <span className="chip-button" key={reference.paragraphId} title={reference.paragraphId}>
                  {reference.friendlyLocation}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="section">
          <h2>全局资料</h2>
          <button className="row" onClick={() => onOpenGlobalPage('canon')} type="button">
            <div className="row-title"><span>角色人设与世界观</span><span className="badge">全局</span></div>
            <div className="row-meta">Markdown 大纲、角色卡、设定规则。</div>
          </button>
          <button className="row" onClick={() => onOpenGlobalPage('memory')} type="button">
            <div className="row-title"><span>记忆待确认</span><span className="badge warn">待确认</span></div>
            <div className="row-meta">人物、道具、关系和知情范围。</div>
          </button>
          <button className="row" onClick={() => onOpenGlobalPage('timeline')} type="button">
            <div className="row-title"><span>查看时间线</span><span className="badge">时间</span></div>
            <div className="row-meta">按故事线和章节顺序排查错位。</div>
          </button>
        </div>
      </div>
    </aside>
  );
}

function WorkspaceInspector({
  activePage,
  activeChapter,
  agentExplicitReferences,
  quickActionScope,
  referenceBasket,
  selectedParagraphId,
}: {
  activePage: WorkspacePageId;
  activeChapter: EditableChapterResult | null;
  agentExplicitReferences: ReferenceBasket;
  quickActionScope: TextActionScope | null;
  referenceBasket: ReferenceBasket;
  selectedParagraphId: string | null;
}) {
  const selectedParagraph = activeChapter?.paragraphs.find((paragraph) => paragraph.id === selectedParagraphId);
  return (
    <div className="inspector-stack">
      <section className="context-panel">
        <h3>{activePage === 'chat' ? 'Agent 上下文' : '任务上下文'}</h3>
        {activePage === 'chat' ? (
          <>
            {agentExplicitReferences.length > 0 ? (
              agentExplicitReferences.map((reference) => (
                <div className="context-line" key={reference.paragraphId}>
                  <strong>@引用</strong>
                  <span>{reference.friendlyLocation}</span>
                </div>
              ))
            ) : (
              <p className="context-empty">Agent 只使用你显式添加的引用。点击“添加引用”加入当前段落或选区。</p>
            )}
          </>
        ) : (
          <div className="context-line">
            <strong>{quickActionScope ? quickActionScope.scopeLabel : selectedParagraph?.friendlyLabel ?? '当前范围'}</strong>
            <span>{activeChapter?.title ?? '未载入章节'}</span>
          </div>
        )}
      </section>
      <section className="mini-manuscript">
        <h3>正文对照</h3>
        {selectedParagraph ? (
          <section className="para compact active">
            <div className="pid" title={selectedParagraph.id}>{selectedParagraph.friendlyLabel.replace(/[^\d]/g, '') || selectedParagraph.index + 1}</div>
            <p className="ptext">{quickActionScope?.selectedText ?? selectedParagraph.text}</p>
          </section>
        ) : (
          <p className="empty-copy">选择段落后，这里显示对照文本。</p>
        )}
      </section>
      {referenceBasket.length > 0 ? (
        <section className="context-panel">
          <h3>搜索引用</h3>
          {referenceBasket.slice(0, 4).map((reference) => (
            <div className="context-line" key={reference.paragraphId}>
              <strong>{reference.friendlyLocation}</strong>
              <span>{previewRevisionText(reference.text)}</span>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

type CategoryRow = {
  title: string;
  badge: string;
  meta: string;
  badgeKind?: 'good' | 'warn' | 'danger';
};

type TimelineViewId = 'events' | 'participants' | 'confirmed' | 'pending';

type TimelineCategoryRow = CategoryRow & {
  id: TimelineViewId;
};

type CanonDocumentPage = {
  id: string;
  sourceFileName: string;
  displayTitle: string;
  description: string;
};

const canonDocumentPages: CanonDocumentPage[] = [
  {
    id: 'overview',
    sourceFileName: '00-project-overview.md',
    displayTitle: '项目概览',
    description: '作品定位、主角动线、当前阶段和后续协作的入口。',
  },
  {
    id: 'theme',
    sourceFileName: '01-theme-and-proposition.md',
    displayTitle: '主题命题',
    description: '作品要反复追问的问题、情感代价和结局余味。',
  },
  {
    id: 'world',
    sourceFileName: '02-worldbuilding.md',
    displayTitle: '世界观',
    description: '世界规则、组织结构、禁忌、代价和例外。',
  },
  {
    id: 'cast',
    sourceFileName: '03-cast-bible.md',
    displayTitle: '角色人设',
    description: '主要角色的欲望、恐惧、秘密、变化线和说话方式。',
  },
  {
    id: 'relationships',
    sourceFileName: '04-relationship-map.md',
    displayTitle: '关系图谱',
    description: '角色之间的债、误会、盟约、敌意和变化压力。',
  },
  {
    id: 'plotlines',
    sourceFileName: '05-main-plotlines.md',
    displayTitle: '主线支线',
    description: '长线目标、支线牵引、线索交汇和当前推进状态。',
  },
  {
    id: 'foreshadowing',
    sourceFileName: '06-foreshadow-ledger.md',
    displayTitle: '伏笔台账',
    description: '已经埋下的线索、预期回收、风险和作者备注。',
  },
  {
    id: 'roadmap',
    sourceFileName: '07-chapter-roadmap.md',
    displayTitle: '章节路线',
    description: '章节级推进计划、阶段目标和未完成的叙事任务。',
  },
  {
    id: 'dynamic',
    sourceFileName: '08-dynamic-state.md',
    displayTitle: '动态状态',
    description: '当前已发生变化的人物状态、道具位置和未解决压力。',
  },
  {
    id: 'style',
    sourceFileName: '09-style-guide.md',
    displayTitle: '风格指南',
    description: '叙述距离、节奏、语言禁区、人物声线和润色边界。',
  },
];

const canonTypeLabels: Record<string, string> = {
  overview: '概览',
  theme: '主题',
  character: '角色',
  world_rule: '世界观',
  relationship: '关系',
  plotline: '主线',
  chapter_roadmap: '章节大纲',
  foreshadowing: '伏笔',
  dynamic_state: '状态',
  style: '风格',
  note: '笔记',
};

function recordTypeLabel(recordType: string): string {
  return canonTypeLabels[recordType] ?? recordType;
}

function statusBadgeKind(status: string): 'good' | 'warn' {
  return status === 'user_confirmed' ? 'good' : 'warn';
}

function statusDisplayLabel(status: string): string {
  if (status === 'user_confirmed') {
    return '已确认';
  }
  if (status === 'rejected') {
    return '已拒绝';
  }
  if (status === 'retconned') {
    return '已修订';
  }
  return '待确认';
}

function clippedDisplayText(value: string, length = 240): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > length ? `${normalized.slice(0, length)}...` : normalized;
}

function canonRecordsForPage(canonRecords: CanonRecord[], page: CanonDocumentPage): CanonRecord[] {
  return canonRecords.filter((record) => record.sourceFileName === page.sourceFileName);
}

function buildCanonDocumentRows(
  canonSources: CanonListResult['sources'],
  canonRecords: CanonRecord[]
): CategoryRow[] {
  return canonDocumentPages.map((page) => {
    const source = canonSources.find((item) => item.fileName === page.sourceFileName);
    const count = canonRecordsForPage(canonRecords, page).length;
    return {
      title: page.displayTitle,
      badge: String(count),
      meta: source ? '已生成' : '待分析',
      badgeKind: source ? 'good' as const : undefined,
    };
  });
}

function buildMemoryCategoryRows(memoryCards: MemoryCard[]): CategoryRow[] {
  const rows: Array<{ kind: MemoryCard['kind']; title: string; meta: string }> = [
    { kind: 'entity', title: '实体证据', meta: '人物、地点、组织' },
    { kind: 'fact', title: '事实证据', meta: '状态、认知、关系' },
    { kind: 'event', title: '事件证据', meta: '时间线来源' },
    { kind: 'world_rule', title: '规则证据', meta: '正文中的规则表述' },
    { kind: 'foreshadowing', title: '伏笔证据', meta: '设置与回收证据' },
  ];
  return rows.map((row) => {
    const count = memoryCards.filter((card) => card.kind === row.kind).length;
    return {
      title: row.title,
      badge: String(count),
      meta: count > 0 ? row.meta : '暂无记录',
      badgeKind: count > 0 ? 'good' as const : undefined,
    };
  });
}

function buildTimelineCategoryRows(nodes: TimelineQueryResult['nodes']): TimelineCategoryRow[] {
  const confirmedCount = nodes.filter((node) => node.status === 'user_confirmed').length;
  const pendingCount = nodes.length - confirmedCount;
  const participantCount = new Set(nodes.flatMap((node) => node.participants)).size;
  return [
    { id: 'events', title: '事件节点', badge: String(nodes.length), meta: nodes.length > 0 ? '已抽取' : '暂无事件', badgeKind: nodes.length > 0 ? 'good' : undefined },
    { id: 'participants', title: '涉及对象', badge: String(participantCount), meta: participantCount > 0 ? '角色、道具或地点' : '等待记忆抽取' },
    { id: 'confirmed', title: '已确认', badge: String(confirmedCount), meta: confirmedCount > 0 ? '作者确认' : '暂无确认', badgeKind: confirmedCount > 0 ? 'good' : undefined },
    { id: 'pending', title: '待确认', badge: String(pendingCount), meta: pendingCount > 0 ? '需要作者判断' : '暂无待确认', badgeKind: pendingCount > 0 ? 'warn' : undefined },
  ];
}

function filterTimelineNodesByView(nodes: TimelineQueryResult['nodes'], viewId: TimelineViewId): TimelineQueryResult['nodes'] {
  if (viewId === 'confirmed') {
    return nodes.filter((node) => node.status === 'user_confirmed');
  }
  if (viewId === 'pending') {
    return nodes.filter((node) => node.status !== 'user_confirmed');
  }
  return nodes;
}

function buildTimelineParticipantGroups(nodes: TimelineQueryResult['nodes']) {
  const groups = new Map<string, TimelineQueryResult['nodes']>();
  for (const node of nodes) {
    for (const participant of node.participants) {
      const name = participant.trim();
      if (!name) {
        continue;
      }
      groups.set(name, [...(groups.get(name) ?? []), node]);
    }
  }
  return [...groups.entries()]
    .map(([name, items]) => ({
      name,
      nodes: items,
      confirmedCount: items.filter((node) => node.status === 'user_confirmed').length,
      pendingCount: items.filter((node) => node.status !== 'user_confirmed').length,
    }))
    .sort((a, b) => b.nodes.length - a.nodes.length || a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

function timelineEmptyText(viewId: TimelineViewId, timelineStatus: string): string {
  if (viewId === 'participants') {
    return '当前时间线还没有识别出涉及对象。';
  }
  if (viewId === 'confirmed') {
    return '还没有作者确认的时间线事件。';
  }
  if (viewId === 'pending') {
    return '没有待确认的时间线事件。';
  }
  return timelineStatus;
}

function GlobalProjectPage({
  activePage,
  canonRecords,
  canonSources,
  canonStatus,
  memoryCards,
  memoryStatus,
  timelineResult,
  timelineStatus,
  onConfirmMemory,
  onAnalyzeProject,
  onAnalyzeTimeline,
  onRefreshTimeline,
}: {
  activePage: 'canon' | 'memory' | 'timeline';
  canonRecords: CanonRecord[];
  canonSources: CanonListResult['sources'];
  canonStatus: string;
  memoryCards: MemoryCard[];
  memoryStatus: string;
  timelineResult: TimelineQueryResult | null;
  timelineStatus: string;
  onConfirmMemory: () => Promise<void>;
  onAnalyzeProject: () => Promise<void>;
  onAnalyzeTimeline: () => Promise<void>;
  onRefreshTimeline: () => Promise<void>;
}) {
  const pendingMemoryCount = memoryCards.filter((card) => card.status !== 'user_confirmed').length;
  const [activeCanonDocumentId, setActiveCanonDocumentId] = useState(canonDocumentPages[0].id);
  const [activeTimelineView, setActiveTimelineView] = useState<TimelineViewId>('events');
  const selectedCanonDocument =
    canonDocumentPages.find((page) => page.id === activeCanonDocumentId) ?? canonDocumentPages[0];
  const selectedCanonRecords = canonRecordsForPage(canonRecords, selectedCanonDocument);
  const selectedCanonSource = canonSources.find((source) => source.fileName === selectedCanonDocument.sourceFileName);
  const generatedCanonPageCount = canonDocumentPages.filter((page) =>
    canonSources.some((source) => source.fileName === page.sourceFileName)
  ).length;
  const timelineNodes = timelineResult?.nodes ?? [];
  const timelineRows = buildTimelineCategoryRows(timelineNodes);
  const visibleTimelineNodes = filterTimelineNodesByView(timelineNodes, activeTimelineView);
  const timelineParticipantGroups = buildTimelineParticipantGroups(timelineNodes);

  if (activePage === 'canon') {
    return (
      <section className="global-page">
        <aside className="panel">
          <div className="panel-head">
            <div className="panel-title"><strong>全局设定</strong><span>作品设定与写作控制</span></div>
          </div>
          <div className="panel-body list">
            {buildCanonDocumentRows(canonSources, canonRecords).map(({ title, badge, meta, badgeKind }, index) => {
              const page = canonDocumentPages[index];
              return (
                <button
                  className={selectedCanonDocument.id === page.id ? 'row active' : 'row'}
                  key={page.id}
                  onClick={() => setActiveCanonDocumentId(page.id)}
                  type="button"
                >
                  <div className="row-title">
                    <span>{title}</span>
                    <span className={badgeKind ? `badge ${badgeKind}` : 'badge'}>{badge}</span>
                  </div>
                  <div className="row-meta">{meta}</div>
                </button>
              );
            })}
          </div>
        </aside>
        <section className="content global-content">
          <div className="content-head">
            <div>
              <h1>全局设定</h1>
              <p>作品设定与写作控制。每个页面单独管理，供 Agent、润色、校对和矛盾检查引用。</p>
            </div>
            <div className="inline-actions">
              <button className="button primary" onClick={() => void onAnalyzeProject()} type="button">
                分析项目
              </button>
            </div>
          </div>
          <div className="content-scroll">
            <div className="canon-document-layout">
              <section className="canon-document-page">
                <div className="canon-document-head">
                  <div>
                    <h2>{selectedCanonDocument.displayTitle}</h2>
                    <p>{selectedCanonDocument.description}</p>
                  </div>
                  <span className={selectedCanonSource ? 'badge good' : 'badge warn'}>
                    {selectedCanonSource ? '已生成' : '待分析'}
                  </span>
                </div>
                {selectedCanonRecords.length > 0 ? (
                  <div className="profile-list">
                    {selectedCanonRecords.map((record) => (
                      <article className="profile-card canon-record-card" key={record.id}>
                        <div className="card-title-row">
                          <h3>{record.headingPath}</h3>
                          <span className={`badge ${statusBadgeKind(record.status)}`}>{recordTypeLabel(record.recordType)}</span>
                        </div>
                        <p>{record.text}</p>
                        <div className="row-meta">{statusDisplayLabel(record.status)}</div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-editor-state">
                    <p>当前项目还没有生成全局设定文档。</p>
                    <span>点击“分析项目”后，会按页面生成并解析角色、人设、世界观、主线、伏笔和章节路线。</span>
                  </div>
                )}
              </section>
              <aside className="canon-document-aside">
                <strong>当前页面</strong>
                <p>{selectedCanonDocument.description}</p>
                <div className="canon-stat-grid">
                  <div><span>{selectedCanonRecords.length}</span><small>记录</small></div>
                  <div><span>{generatedCanonPageCount}</span><small>页面</small></div>
                </div>
                <p className="muted">{canonStatus}</p>
              </aside>
            </div>
          </div>
        </section>
      </section>
    );
  }

  if (activePage === 'memory') {
    return (
      <section className="global-page">
        <aside className="panel">
          <div className="panel-head">
            <div className="panel-title"><strong>正文记忆</strong><span>证据、状态、来源</span></div>
          </div>
          <div className="panel-body list">
            {buildMemoryCategoryRows(memoryCards).map(({ title, badge, meta, badgeKind }, index) => (
              <div className={index === 0 ? 'row active' : 'row'} key={title}>
                <div className="row-title">
                  <span>{title}</span>
                  <span className={badgeKind ? `badge ${badgeKind}` : 'badge'}>{badge}</span>
                </div>
                <div className="row-meta">{meta}</div>
              </div>
            ))}
          </div>
        </aside>
        <section className="content global-content">
          <div className="content-head">
            <div>
              <h1>正文记忆库</h1>
              <p>正文证据，不是设定大纲。这里保存从原文抽出的事实、状态和证据位置。</p>
            </div>
            <button
              className="button primary"
              disabled={pendingMemoryCount === 0}
              onClick={() => void onConfirmMemory()}
              type="button"
            >
              {pendingMemoryCount > 0 ? '确认待确认记忆' : '暂无待确认记忆'}
            </button>
          </div>
          <div className="content-scroll">
            <div className="sheet">
              <table className="table">
                <thead><tr><th>对象</th><th>正文事实</th><th>证据位置</th><th>状态</th><th>用途</th></tr></thead>
                <tbody>
                  {memoryCards.length > 0 ? (
                    memoryCards.map((card) => (
                      <tr key={card.id}>
                        <td>{card.title}</td>
                        <td>{card.body}</td>
                        <td>{card.sourceLocation ?? (card.sourceQuote || '无来源')}</td>
                        <td><span className={card.status === 'user_confirmed' ? 'badge good' : 'badge warn'}>{card.status}</span></td>
                        <td>{card.impact}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td className="muted" colSpan={5}>{memoryStatus}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="global-page">
      <aside className="panel">
        <div className="panel-head">
          <div className="panel-title"><strong>时间线</strong><span>全局线索</span></div>
        </div>
        <div className="panel-body list">
          {timelineRows.map(({ id, title, badge, meta, badgeKind }) => (
            <button className={activeTimelineView === id ? 'row active' : 'row'} key={id} onClick={() => setActiveTimelineView(id)} type="button">
              <div className="row-title">
                <span>{title}</span>
                <span className={badgeKind ? `badge ${badgeKind}` : 'badge'}>{badge}</span>
              </div>
              <div className="row-meta">{meta}</div>
            </button>
          ))}
        </div>
      </aside>
      <section className="content global-content">
        <div className="content-head">
          <div>
            <h1>全局时间线</h1>
            <p>按正文顺序梳理事件、人物状态和道具去向，方便检查跳线和遗漏。</p>
          </div>
          <div className="inline-actions">
            <button className="button primary" onClick={() => void onAnalyzeTimeline()} type="button">
              分析时间线
            </button>
            <button className="button" onClick={() => void onRefreshTimeline()} type="button">
              刷新时间线
            </button>
          </div>
        </div>
        <div className="content-scroll">
          <div className="sheet">
            <div className="timeline-board">
              {activeTimelineView === 'participants' ? (
                timelineParticipantGroups.length ? (
                  <div className="timeline-participant-list">
                    {timelineParticipantGroups.map((group) => (
                      <article className="timeline-participant-card" key={group.name}>
                        <div className="timeline-participant-head">
                          <div>
                            <strong>{group.name}</strong>
                            <span>{group.nodes.length} 个相关事件</span>
                          </div>
                          <div className="timeline-tags">
                            <span>待确认 {group.pendingCount}</span>
                            <span>已确认 {group.confirmedCount}</span>
                          </div>
                        </div>
                        <div className="timeline-participant-events">
                          {group.nodes.slice(0, 5).map((node) => (
                            <div className="timeline-mini-event" key={`${group.name}-${node.id}`}>
                              <span>{node.friendlyLocation ?? node.normalizedTime ?? node.chapterTitle ?? '事件'}</span>
                              <p>{node.summary}</p>
                            </div>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-editor-state">
                    <p>{timelineEmptyText(activeTimelineView, timelineStatus)}</p>
                  </div>
                )
              ) : visibleTimelineNodes.length ? (
                <div className="timeline-event-list">
                  {visibleTimelineNodes.map((node, index) => (
                    <article
                      className={node.status === 'user_confirmed' ? 'timeline-event-card good' : 'timeline-event-card warn'}
                      key={node.id}
                    >
                      <div className="timeline-marker"><span>{index + 1}</span></div>
                      <div className="timeline-event-main">
                        <div className="timeline-event-top">
                          <strong>{node.friendlyLocation ?? node.normalizedTime ?? node.chapterTitle ?? '事件'}</strong>
                          <span className={node.status === 'user_confirmed' ? 'badge good' : 'badge warn'}>
                            {node.status === 'user_confirmed' ? '已确认' : '待确认'}
                          </span>
                        </div>
                        <p>{node.summary}</p>
                        {node.timeExpression || node.normalizedTime || node.participants.length > 0 ? (
                          <div className="timeline-tags">
                            {node.timeExpression ? <span>{node.timeExpression}</span> : null}
                            {node.normalizedTime ? <span>{node.normalizedTime}</span> : null}
                            {node.participants.map((participant) => (
                              <span key={`${node.id}-${participant}`}>{participant}</span>
                            ))}
                          </div>
                        ) : null}
                        {node.sourceQuote ? <blockquote>{clippedDisplayText(node.sourceQuote)}</blockquote> : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-editor-state">
                  <p>{timelineEmptyText(activeTimelineView, timelineStatus)}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
function ExportPage({
  chapterCount,
  exportFormat,
  exportOutputPath,
  exportPreview,
  exportStatus,
  setExportFormat,
  setExportOutputPath,
  onRefreshPreview,
  onRunExport,
}: {
  chapterCount: number;
  exportFormat: ExportFormat;
  exportOutputPath: string;
  exportPreview: ExportPreviewResult | null;
  exportStatus: string;
  setExportFormat: (format: ExportFormat) => void;
  setExportOutputPath: (value: string) => void;
  onRefreshPreview: () => Promise<void>;
  onRunExport: () => Promise<void>;
}) {
  return (
    <section className="export-view">
      <aside className="panel">
        <div className="panel-head">
          <div className="panel-title"><strong>导出</strong><span>TXT / EPUB</span></div>
        </div>
        <div className="panel-body form-stack">
          <div className="field">
            <label>格式</label>
            <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}>
              <option value="txt">TXT</option>
              <option value="epub">EPUB</option>
            </select>
          </div>
          <div className="field">
            <label>范围</label>
            <select defaultValue="全书">
              <option>全书</option>
              <option>当前卷</option>
              <option>当前章节</option>
            </select>
          </div>
          <div className="field">
            <label>导出文件路径</label>
            <input
              placeholder={exportPreview?.defaultOutputPath ?? '打开项目后自动生成'}
              value={exportOutputPath}
              onChange={(event) => setExportOutputPath(event.target.value)}
            />
          </div>
          <button className="button" onClick={() => void onRefreshPreview()} type="button">
            刷新预览
          </button>
          <button className="button primary" onClick={() => void onRunExport()} type="button">
            开始导出
          </button>
        </div>
      </aside>
      <section className="content global-content">
        <div className="content-head">
          <div>
            <h1>导出预览</h1>
            <p>导出不改变正文。未解决问题会记录在导出日志中。</p>
          </div>
          <span className={exportPreview?.unresolvedHighRiskIssueCount ? 'badge warn' : 'badge good'}>
            {exportPreview ? `${exportPreview.unresolvedHighRiskIssueCount} 个高风险问题` : '等待预览'}
          </span>
        </div>
        <div className="content-scroll">
          <div className="sheet">
            <div className="grid-2">
              <div className="card subtle"><strong className="mono">{exportPreview?.chapterCount ?? chapterCount}</strong><p>章节</p></div>
              <div className="card subtle"><strong className="mono">{exportPreview?.characterCount ?? 0}</strong><p>中文字符</p></div>
            </div>
            <div className="section">
              <table className="table">
                <tbody>
                  {exportPreview?.artifacts.length ? (
                    exportPreview.artifacts.map((artifact) => (
                      <tr key={artifact.outputPath}>
                        <td>{artifact.fileName}</td>
                        <td>{artifact.description}</td>
                        <td><span className="badge">{artifact.status}</span></td>
                      </tr>
                    ))
                  ) : (
                    <tr><td className="muted" colSpan={3}>暂无导出预览</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="section">
              <div className="progress"><span /></div>
              <p className="muted">{exportStatus}</p>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}

function ImportWorkspace({
  baseDirectory,
  isBusy,
  projectName,
  preview,
  selectedFilePath,
  selectedFileType,
  onBack,
  onChoose,
  onCommit,
  onPreview,
}: {
  baseDirectory: string;
  isBusy: boolean;
  projectName: string;
  preview: ImportPreviewResult | null;
  selectedFilePath: string;
  selectedFileType: 'txt' | 'epub';
  onBack: () => void;
  onChoose: () => Promise<void>;
  onCommit: () => Promise<void>;
  onPreview: () => Promise<void>;
}) {
  const hasPreview = Boolean(preview);

  return (
    <article className="import">
      <aside className="panel">
        <div className="panel-head">
          <div className="panel-title">
            <strong>新建项目</strong>
            <span>选择手稿后自动创建</span>
          </div>
        </div>
        <div className="panel-body">
          <div className="list">
            <button
              className={selectedFileType === 'txt' ? 'file-choice active' : 'file-choice'}
              disabled={isBusy}
              onClick={onChoose}
              type="button"
            >
              <strong>选择 TXT 文件</strong>
              <span>适合网文、长篇草稿、纯文本手稿。自动检测编码和章节标题。</span>
            </button>
            <button
              className={selectedFileType === 'epub' ? 'file-choice active' : 'file-choice'}
              disabled={isBusy}
              onClick={onChoose}
              type="button"
            >
              <strong>选择 EPUB 文件</strong>
              <span>按目录顺序抽取正文，不处理加密书。</span>
            </button>
          </div>
          <div className="section">
            <button className="button primary" disabled={isBusy} onClick={onChoose} type="button">
              选择手稿文件
            </button>
            <button className="button" onClick={onBack} type="button">
              返回
            </button>
          </div>
          <div className="section">
            <h2>自动创建内容</h2>
            <p className="muted">项目文件、原稿备份、导出目录和编辑记录。作者不需要先填项目表单。</p>
          </div>
        </div>
      </aside>

      <section className="content">
        <div className="content-head">
          <div>
            <h1>{hasPreview ? preview?.preview.fileName : '等待选择 TXT 或 EPUB 文件'}</h1>
            <p>选择手稿后预览章节，确认后自动创建本地项目。</p>
          </div>
          <button className="button primary" disabled={isBusy || !hasPreview} onClick={onCommit} type="button">
            创建项目并导入
          </button>
        </div>
        <div className="content-scroll">
          <div className="sheet">
            <div className="section">
              <h2>章节拆分预览</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>顺序</th>
                    <th>章节标题</th>
                    <th>段落</th>
                    <th>字数</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {preview ? (
                    preview.preview.chapters.map((chapter) => (
                      <tr key={`${chapter.index}-${chapter.title}`}>
                        <td>{chapter.index + 1}</td>
                        <td>{chapter.title}</td>
                        <td>{chapter.paragraphCount}</td>
                        <td>{chapter.paragraphs.join('').length}</td>
                        <td>{chapter.suspiciousHeadingMarkers.length > 0 ? '需检查' : '可导入'}</td>
                        <td>
                          <button className="button" onClick={onPreview} type="button">
                            预览
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="muted" colSpan={6}>
                        尚未选择文件。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="section grid-2">
              <div className="card subtle">
                <strong>原文件</strong>
                <p>{selectedFilePath.trim() || '未选择'}</p>
              </div>
              <div className="card subtle">
                <strong>导入后任务</strong>
                <p>建立搜索、章节摘要和记忆索引。任务状态显示在底部。</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside className="panel right">
        <div className="panel-head">
          <div className="panel-title">
            <strong>导入检查</strong>
            <span>可修改，但默认自动完成</span>
          </div>
        </div>
        <div className="panel-body">
          <div className="card subtle">
            <strong>{selectedFilePath.trim() ? projectName : '等待文件'}</strong>
            <p>作者最常见路径应该是：选文件，看一眼预览，确认导入。</p>
          </div>
          <div className="section">
            <div className="progress">
              <span style={{ width: hasPreview ? '62%' : '0%' }} />
            </div>
            {hasPreview ? (
              <div className="path-preview" title={baseDirectory}>
                <span>将保存到</span>
                <code>{baseDirectory}</code>
              </div>
            ) : (
              <p className="muted">尚未开始。</p>
            )}
          </div>
        </div>
      </aside>
    </article>
  );
}

function EditorColumn({
  activeChapter,
  contextMenu,
  editorStatus,
  highlightedParagraphId,
  isLoading,
  quickActionScope,
  showSelectionControls,
  selectedParagraphId,
  onEditParagraph,
  onQuickAction,
  onSaveParagraph,
  onSelectParagraph,
  onSelectionDismiss,
  onSelectionChange,
}: {
  activeChapter: EditableChapterResult | null;
  contextMenu: { x: number; y: number } | null;
  editorStatus: string;
  highlightedParagraphId: string | null;
  isLoading: boolean;
  quickActionScope: TextActionScope | null;
  showSelectionControls: boolean;
  selectedParagraphId: string | null;
  onEditParagraph: (paragraphId: string, text: string) => void;
  onQuickAction: (action: QuickActionKind, scope?: TextActionScope | null) => void;
  onSaveParagraph: (paragraphId: string, text: string) => Promise<void>;
  onSelectParagraph: (paragraphId: string) => void;
  onSelectionDismiss: () => void;
  onSelectionChange: (scope: TextActionScope | null, menuPosition?: { x: number; y: number } | null) => void;
}) {
  const selectedParagraph = activeChapter?.paragraphs.find((paragraph) => paragraph.id === selectedParagraphId);
  const scopeLabel = quickActionScope?.scopeLabel ?? selectedParagraph?.friendlyLabel ?? '未选择段落';

  function updateSelection(
    paragraph: EditableParagraphResult,
    target: HTMLTextAreaElement,
    menuPosition?: { x: number; y: number }
  ) {
    const scope = buildTextScope({
      paragraphId: paragraph.id,
      friendlyLabel: paragraph.friendlyLabel,
      text: paragraph.text,
      selectionStart: target.selectionStart,
      selectionEnd: target.selectionEnd,
    });
    onSelectParagraph(paragraph.id);
    onSelectionChange(scope, scope.kind === 'selection' ? (menuPosition ?? null) : null);
  }

  return (
    <article className="editor-column">
      <div className="chapter-head">
        <div>
          <span className="crumb">{activeChapter ? `${activeChapter.title} / ${scopeLabel}` : scopeLabel}</span>
          <h2>正文编辑</h2>
        </div>
        <div className="editor-actions">
          <span>{isLoading ? '载入中' : scopeLabel}</span>
          {editorQuickActionButtons.map((action) => (
            <button
              disabled={!selectedParagraphId}
              key={action.kind}
              onClick={() => onQuickAction(action.kind)}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
      <div className="manuscript-layout">
        <section className="chapter-list" aria-label="章节段落" onScroll={onSelectionDismiss} onWheel={onSelectionDismiss}>
          {activeChapter ? (
            <>
              <h1 className="manuscript-title">{activeChapter.title}</h1>
              {activeChapter.paragraphs.map((paragraph) => (
                <label
                  className={[
                    'paragraph-editor',
                    selectedParagraphId === paragraph.id ? 'selected' : '',
                    isHighlightedParagraph(highlightedParagraphId, paragraph.id) ? 'search-hit' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={paragraph.id}
                >
                  <span>
                    {paragraph.friendlyLabel}
                    <em>v{paragraph.version}</em>
                  </span>
                  <textarea
                    value={paragraph.text}
                    onBlur={() => void onSaveParagraph(paragraph.id, paragraph.text)}
                    onChange={(event) => onEditParagraph(paragraph.id, event.target.value)}
                    onContextMenu={(event) => {
                      updateSelection(paragraph, event.currentTarget, { x: event.clientX, y: event.clientY });
                      if (event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) {
                        event.preventDefault();
                      }
                    }}
                    onFocus={(event) => updateSelection(paragraph, event.currentTarget)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        onSelectionDismiss();
                      }
                    }}
                    onKeyUp={(event) => {
                      if (event.key !== 'Escape') {
                        updateSelection(paragraph, event.currentTarget);
                      }
                    }}
                    onMouseDown={(event) => {
                      if (event.button === 2 && event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) {
                        event.preventDefault();
                        updateSelection(paragraph, event.currentTarget, { x: event.clientX, y: event.clientY });
                      }
                    }}
                    onMouseUp={(event) => {
                      if (event.button === 0) {
                        updateSelection(paragraph, event.currentTarget);
                      }
                    }}
                  />
                </label>
              ))}
            </>
          ) : (
            <div className="empty-editor-state">
              <p>{isLoading ? '正在载入章节...' : editorStatus}</p>
            </div>
          )}
        </section>
        {showSelectionControls && quickActionScope?.kind === 'selection' ? (
          <div className={quickActionScope.tooLong ? 'selection-toolbar warning' : 'selection-toolbar'} role="toolbar" aria-label="选区快捷动作">
            <span>{quickActionScope.scopeLabel}</span>
            {quickActionScope.tooLong ? <strong>选区过长</strong> : null}
            {editorQuickActionButtons.map((action) => (
              <button
                disabled={!canRunQuickAction(action.kind, quickActionScope).ok}
                key={action.kind}
                onClick={() => onQuickAction(action.kind)}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
        {showSelectionControls && contextMenu && quickActionScope?.kind === 'selection' ? (
          <div className="selection-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu">
            {editorQuickActionButtons.map((action) => (
              <button
                disabled={!canRunQuickAction(action.kind, quickActionScope).ok}
                key={action.kind}
                onClick={() => onQuickAction(action.kind)}
                role="menuitem"
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function formatRevisionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function PagePanel({
  activePage,
  activeChapter,
  activeProvider,
  providerStatus,
  activateProvider,
  hasDesktopApi,
  pendingRestoreId,
  quickActionScope,
  referenceBasket,
  revisionItems,
  revisionStatus,
  searchQuery,
  searchResult,
  searchStatus,
  setSearchQuery,
  selectedParagraphId,
	  aiPreflight,
	  aiTaskStatus,
	  chatAgentResult,
	  chatAgentStatus,
	  proofreadIssues,
	  issuePanelStatus,
	  taskInstruction,
  setTaskInstruction,
  agentMode,
  setAgentMode,
  agentInstructionPreset,
  setAgentInstructionPreset,
  agentExplicitReferences,
  polishStrength,
  setPolishStrength,
  polishFocus,
  setPolishFocus,
  polishForbiddenChanges,
  setPolishForbiddenChanges,
  expandPreviousContext,
  setExpandPreviousContext,
  expandNextBeats,
  setExpandNextBeats,
  expandFocusDetails,
  setExpandFocusDetails,
  expandForbiddenChanges,
  setExpandForbiddenChanges,
  expandPov,
  setExpandPov,
  expandTargetLength,
  setExpandTargetLength,
  expandStyleStrength,
  setExpandStyleStrength,
  taskModelProfile,
  onAddSearchResult,
  onCancelRestore,
  onConfirmRestore,
  onJumpSearchResult,
  onOpenSettings,
	  onAcceptCandidate,
	  onRejectCandidate,
  onDeleteProviderKey,
  onRestoreRecommendedTaskModelProfile,
	  onApplyAgentArtifact,
	  onRejectAgentArtifact,
	  onRunAiTaskPreflight,
	  onRunAgentChat,
	  onRunLocalProofread,
	  onRunSearch,
  onAddAgentReference,
  onChooseAgentInstruction,
  onSaveProviderKey,
  onSelectRestore,
  onSendReferencesToPage,
  onTestProviderConnection,
	  onUpdateReferenceBasket,
	  onUpdateTaskModelSetting,
	  onUpdateProofreadIssueStatus,
	}: {
  activePage: PanelPageId;
  activeChapter: EditableChapterResult | null;
  activeProvider: 'deepseek' | 'openrouter' | null;
  providerStatus: ProviderStatusResult | null;
  activateProvider: (providerId: 'deepseek' | 'openrouter') => Promise<void>;
  hasDesktopApi: boolean;
  pendingRestoreId: string | null;
  quickActionScope: TextActionScope | null;
  referenceBasket: ReferenceBasket;
  revisionItems: RevisionListResult;
  revisionStatus: string;
  searchQuery: string;
  searchResult: SearchResult | null;
  searchStatus: string;
  setSearchQuery: (value: string) => void;
  selectedParagraphId: string | null;
	  aiPreflight: AiTaskPreflightResult | null;
	  aiTaskStatus: string;
	  chatAgentResult: ChatAgentResult | null;
	  chatAgentStatus: string;
	  proofreadIssues: IssueCard[];
	  issuePanelStatus: string;
  taskInstruction: string;
  setTaskInstruction: (value: string) => void;
  agentMode: AgentUiMode;
  setAgentMode: (value: AgentUiMode) => void;
  agentInstructionPreset: AgentInstructionPreset;
  setAgentInstructionPreset: (value: AgentInstructionPreset) => void;
  agentExplicitReferences: ReferenceBasket;
  polishStrength: 'light' | 'medium' | 'heavy';
  setPolishStrength: (value: 'light' | 'medium' | 'heavy') => void;
  polishFocus: string;
  setPolishFocus: (value: string) => void;
  polishForbiddenChanges: string;
  setPolishForbiddenChanges: (value: string) => void;
  expandPreviousContext: string;
  setExpandPreviousContext: (value: string) => void;
  expandNextBeats: string;
  setExpandNextBeats: (value: string) => void;
  expandFocusDetails: string;
  setExpandFocusDetails: (value: string) => void;
  expandForbiddenChanges: string;
  setExpandForbiddenChanges: (value: string) => void;
  expandPov: string;
  setExpandPov: (value: string) => void;
  expandTargetLength: string;
  setExpandTargetLength: (value: string) => void;
  expandStyleStrength: string;
  setExpandStyleStrength: (value: string) => void;
  taskModelProfile: TaskModelProfile;
  onAddSearchResult: (paragraphId: string) => Promise<void>;
  onCancelRestore: () => void;
  onConfirmRestore: () => Promise<void>;
  onJumpSearchResult: (result: SearchResultItem) => Promise<void>;
  onOpenSettings: () => void;
	  onAcceptCandidate: (revisionId: string) => Promise<void>;
	  onRejectCandidate: (revisionId: string) => Promise<void>;
  onDeleteProviderKey: (providerId: 'deepseek' | 'openrouter' | null) => Promise<void>;
  onRestoreRecommendedTaskModelProfile: () => Promise<void>;
	  onApplyAgentArtifact: (artifactId: string) => Promise<void>;
	  onRejectAgentArtifact: (artifactId: string) => Promise<void>;
	  onRunAiTaskPreflight: (page: PageId, execute?: boolean) => Promise<void>;
	  onRunAgentChat: () => Promise<void>;
	  onRunLocalProofread: () => Promise<void>;
	  onRunSearch: () => Promise<void>;
  onAddAgentReference: () => void;
  onChooseAgentInstruction: () => void;
  onSaveProviderKey: (providerId: 'deepseek' | 'openrouter' | null, apiKey: string) => Promise<boolean>;
  onSelectRestore: (revisionId: string) => void;
  onSendReferencesToPage: (target: 'chat' | 'continuity' | 'proofread') => void;
  onTestProviderConnection: (providerId: 'deepseek' | 'openrouter' | null) => Promise<void>;
	  onUpdateReferenceBasket: (paragraphIds: string[]) => Promise<void>;
	  onUpdateTaskModelSetting: (task: TaskType, setting: TaskModelSetting) => Promise<void>;
	  onUpdateProofreadIssueStatus: (issueId: string, status: IssueCard['status']) => Promise<void>;
	}) {
  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const activeModelReady = canRunConnectedModelTask(providerStatus);
  const activeModelRequired = activePage === 'polish' || activePage === 'expand' || activePage === 'proofread';
  const activeModelGateMessage = activeModelRequired ? modelGateMessage(providerStatus, hasDesktopApi) : null;
  const selectedParagraph = activeChapter?.paragraphs.find((paragraph) => paragraph.id === selectedParagraphId) ?? null;

  if (activePage === 'editor') {
    return (
      <aside className="task-panel revision-panel">
        <span className="panel-kicker">版本历史</span>
        <h2>当前段落</h2>
        <p>{revisionStatus}</p>
        <div className="revision-list">
          {revisionItems.length > 0 ? (
            revisionItems.map((revision) => {
              const isPending = pendingRestoreId === revision.id;
              return (
                <article className={isPending ? 'revision-card pending' : 'revision-card'} key={revision.id}>
                  <span>{formatRevisionDate(revision.createdAt)}</span>
                  <strong>修改前</strong>
                  <p>{previewRevisionText(revision.beforeText)}</p>
                  <strong>修改后</strong>
                  <p>{previewRevisionText(revision.afterText)}</p>
                  {isPending ? (
                    <>
                      <div className="revision-diff" aria-label="版本差异">
                        <div className="revision-diff-head">
                          <span>恢复目标</span>
                          <span>修改后</span>
                        </div>
                        {buildRevisionDiffRows(revision.beforeText, revision.afterText).map((row, index) => (
                          <div className={`revision-diff-row ${row.kind}`} key={`${row.kind}-${index}`}>
                            <span>{row.before}</span>
                            <span>{row.after}</span>
                          </div>
                        ))}
                      </div>
                      <div className="revision-actions">
                        <button className="primary-action" onClick={onConfirmRestore} type="button">
                          确认恢复
                        </button>
                        <button className="secondary-action" onClick={onCancelRestore} type="button">
                          取消
                        </button>
                      </div>
                    </>
                  ) : (
                    <button className="secondary-action" onClick={() => onSelectRestore(revision.id)} type="button">
                      恢复到修改前
                    </button>
                  )}
                </article>
              );
            })
          ) : (
            <div className="empty-version-state">保存过修改后，这里会显示可恢复记录。</div>
          )}
        </div>
      </aside>
    );
  }

  if (activePage === 'settings') {
    const selectedProvider = activeProvider ?? (!hasDesktopApi ? 'deepseek' : null);
    const selectedProviderCard = providerCards.find((card) => card.id === selectedProvider) ?? null;
    const configCard = selectedProviderCard ?? providerCards[0];
    const selectedProviderStatus = selectedProvider ? providerStatus?.providers[selectedProvider] : null;
    const isProviderConfigured = Boolean(selectedProviderStatus?.configured);
    const activeChatSetting = taskModelProfile.chat;
    const heroModelLabel = selectedProvider
      ? `${activeChatSetting.modelNameOverride ?? providerDefaultModel(selectedProvider, activeChatSetting.modelRole)} · ${reasoningEffortLabel(activeChatSetting.reasoningEffort)}`
      : '选择供应商后生效';

    const saveKeyFromInput = () => {
      void onSaveProviderKey(selectedProvider, apiKeyInputRef.current?.value ?? '').then((saved) => {
        if (saved && apiKeyInputRef.current) {
          apiKeyInputRef.current.value = '';
        }
      });
    };

    return (
      <section className="settings-view">
        <div className="settings">
          <section className="content settings-content">
            <div className="content-head">
              <div>
                <h1>模型与密钥</h1>
                <p>设置当前使用的模型服务，以及各类写作任务的默认模型。</p>
              </div>
              <button className="button primary" onClick={saveKeyFromInput} type="button">
                保存设置
              </button>
            </div>
            <div className="content-scroll">
              <div className="sheet">
                <div className="settings-hero">
                  <div>
                    <h2>当前供应商: {selectedProviderCard?.title ?? '未选择'}</h2>
                  </div>
                  <div className="hero-actions">
                    <div className="provider-selector" aria-label="当前供应商">
                      {providerCards.map((card) => {
                        const connection = providerStatus?.providers[card.id].connection.status;
                        const isActive = selectedProvider === card.id;
                        return (
                          <button
                            aria-pressed={isActive}
                            className={isActive ? 'provider-option active' : 'provider-option'}
                            key={card.id}
                            onClick={() => void activateProvider(card.id)}
                            type="button"
                          >
                            <span className="provider-mark">{card.mark}</span>
                            <span className="provider-copy">
                              <strong>{card.title}</strong>
                              <small>{card.subtitle}</small>
                            </span>
                            <span className="provider-status" aria-hidden="true">
                              {isActive ? '当前使用' : connectionStatusLabel(connection)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <span className="badge">{heroModelLabel}</span>
                  </div>
                </div>

                <div className="provider-grid section">
                  <div className="vault-panel">
                    <div className="vault-head">
                      <div>
                        <h2>密钥保险箱</h2>
                        <p>
                          {selectedProviderCard
                            ? isProviderConfigured
                              ? `${selectedProviderCard.title} 密钥已保存，只显示遮罩。`
                              : `${selectedProviderCard.title} 密钥还未保存。`
                            : '先选择要使用的模型供应商。'}
                        </p>
                      </div>
                      <span className={isProviderConfigured ? 'badge good' : 'badge warn'}>
                        {isProviderConfigured ? '已保存' : '未保存'}
                      </span>
                    </div>
                    <div className="field">
                      <label>{selectedProviderCard?.title ?? '供应商'} 密钥</label>
                      <input
                        placeholder={
                          selectedProvider
                            ? isProviderConfigured
                              ? 'sk-••••••••••••••••'
                              : '粘贴 API Key'
                            : '先选择供应商'
                        }
                        ref={apiKeyInputRef}
                        type="password"
                      />
                    </div>
                    <div className="security-list">
                      <div className="security-row">
                        <strong>连接状态</strong>
                        <span>{connectionStatusLabel(selectedProviderStatus?.connection.status)}</span>
                      </div>
                      <div className="security-row">
                        <strong>换设备</strong>
                        <span>需要在新设备重新填写密钥。</span>
                      </div>
                      <div className="security-row">
                        <strong>导出项目</strong>
                        <span>导出的 TXT、EPUB 和项目文件不会带走密钥。</span>
                      </div>
                    </div>
                    <div className="vault-actions">
                      <button className="button" onClick={() => void onTestProviderConnection(selectedProvider)} type="button">
                        测试连接
                      </button>
                      <button className="button" onClick={saveKeyFromInput} type="button">
                        保存或更换密钥
                      </button>
                      <button className="button danger" onClick={() => void onDeleteProviderKey(selectedProvider)} type="button">
                        删除本机密钥
                      </button>
                    </div>
                  </div>

                  <div className="vault-panel">
                    <div className="vault-head">
                      <div>
                        <h2>{configCard.title} 配置</h2>
                        <p>
                          {configCard.id === 'deepseek'
                            ? '直连 DeepSeek。适合默认使用 DeepSeek V4。'
                            : '通过 OpenRouter 使用模型。DeepSeek V4 仍按 DeepSeek 请求形状发送。'}
                        </p>
                      </div>
                      <span className="badge">{configCard.scopeBadge}</span>
                    </div>
                    <div className="grid-2">
                      <div className="field">
                        <label>接口地址</label>
                        <input readOnly value={configCard.baseUrl} />
                      </div>
                      <div className="field">
                        <label>默认模型</label>
                        <input readOnly value={providerDefaultModel(configCard.id, activeChatSetting.modelRole)} />
                      </div>
                    </div>
                    <div className="security-list">
                      <div className="security-row">
                        <strong>可用模型</strong>
                        <span>{configCard.modelScope}</span>
                      </div>
                      <div className="security-row">
                        <strong>思考模式</strong>
                        <span>每类任务可单独设置思考强度和是否开启思考。</span>
                      </div>
                    </div>
                    <p className="provider-note">
                      {configCard.id === 'openrouter'
                        ? 'OpenRouter 不限定 DeepSeek；当模型 ID 是 DeepSeek V4 时，本项目会使用 DeepSeek 官方 thinking 与 reasoning_effort。'
                        : '默认使用 DeepSeek V4；高风险任务可开启思考，润色和校对默认更保守。'}
                    </p>
                  </div>
                </div>

                <div className="section">
                  <div className="section-title">
                    <h2>任务模型配置</h2>
                    <span>随项目保存，不含密钥</span>
                  </div>
                  <div className="route-board">
                    <div className="route-head">
                      <span>任务</span>
                      <span>模型</span>
                      <span>思考强度</span>
                      <span>思考模式</span>
                      <span>用途</span>
                    </div>
                    {settingsTaskRows.map((row) => {
                      const setting = taskModelProfile[row.task];
                      const providerForModels = selectedProvider ?? 'deepseek';
                      return (
                        <div className="route-line" key={row.task}>
                          <div>
                            <strong>{row.label}</strong>
                            <small>{row.scope}</small>
                          </div>
                          <div className="route-model-cell">
                            <select
                              value={setting.modelRole}
                              onChange={(event) =>
                                void onUpdateTaskModelSetting(row.task, {
                                  ...setting,
                                  modelRole: event.target.value as TaskModelSetting['modelRole'],
                                })
                              }
                            >
                              <option value="pro">{providerDefaultModel(providerForModels, 'pro')}</option>
                              <option value="flash">{providerDefaultModel(providerForModels, 'flash')}</option>
                            </select>
                            {providerForModels === 'openrouter' ? (
                              <input
                                aria-label={`${row.label} OpenRouter 模型 ID`}
                                placeholder="自定义模型 ID"
                                value={setting.modelNameOverride ?? ''}
                                onChange={(event) =>
                                  void onUpdateTaskModelSetting(row.task, {
                                    ...setting,
                                    modelNameOverride: event.target.value.trim() || undefined,
                                  })
                                }
                              />
                            ) : null}
                          </div>
                          <select
                            value={setting.reasoningEffort}
                            onChange={(event) =>
                              void onUpdateTaskModelSetting(row.task, {
                                ...setting,
                                reasoningEffort: event.target.value as TaskModelSetting['reasoningEffort'],
                              })
                            }
                          >
                            <option value="high">高</option>
                            <option value="max">最高</option>
                          </select>
                          <select
                            value={setting.thinkingMode}
                            onChange={(event) =>
                              void onUpdateTaskModelSetting(row.task, {
                                ...setting,
                                thinkingMode: event.target.value as TaskModelSetting['thinkingMode'],
                              })
                            }
                          >
                            <option value="enabled">开启思考</option>
                            <option value="disabled">关闭思考</option>
                          </select>
                          <span className="muted">{row.note}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="route-actions">
                    <button className="button" onClick={() => void onRestoreRecommendedTaskModelProfile()} type="button">
                      恢复推荐值
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>
    );
  }

  if (activePage === 'search') {
    return (
      <aside className="task-panel search-panel">
        <span className="panel-kicker">全文搜索</span>
        <h2>搜索正文</h2>
        <label>
          关键词
          <input
            placeholder="人物、道具、地点或一句原文"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void onRunSearch();
              }
            }}
          />
        </label>
        <button className="primary-action" disabled={!searchQuery.trim()} onClick={onRunSearch} type="button">
          搜索
        </button>
        <p>{searchStatus}</p>
        <section className="reference-basket" aria-label="当前引用">
          <div className="reference-basket-head">
            <strong>当前引用</strong>
            <span>{referenceBasket.length} 条</span>
          </div>
          {referenceBasket.length > 0 ? (
            <>
              <div className="reference-list">
                {referenceBasket.map((reference) => (
                  <article className="reference-item" key={reference.paragraphId}>
                    <span>{reference.friendlyLocation}</span>
                    <p>{previewRevisionText(reference.text)}</p>
                    <button
                      className="secondary-action"
                      onClick={() =>
                        void onUpdateReferenceBasket(
                          referenceBasket
                            .filter((item) => item.paragraphId !== reference.paragraphId)
                            .map((item) => item.paragraphId)
                        )
                      }
                      type="button"
                    >
                      移除
                    </button>
                  </article>
                ))}
              </div>
              <button className="secondary-action" onClick={() => void onUpdateReferenceBasket([])} type="button">
                清空引用
              </button>
              <div className="reference-route-actions">
                <button className="primary-action" onClick={() => onSendReferencesToPage('chat')} type="button">
                  带去问一下
                </button>
                <button className="secondary-action" onClick={() => onSendReferencesToPage('proofread')} type="button">
                  带去校对
                </button>
                <button className="secondary-action" onClick={() => onSendReferencesToPage('continuity')} type="button">
                  带去查矛盾
                </button>
              </div>
            </>
          ) : (
            <p>把搜索结果加入引用后，问一下、校对和检查矛盾会优先带上这些段落。</p>
          )}
        </section>
        <div className="search-results">
          {searchResult?.results.map((result) => (
            <article className="search-result" key={result.paragraphId}>
              <span>{result.friendlyLocation}</span>
              <p>{result.snippet}</p>
              <div className="search-result-actions">
                <button className="secondary-action" onClick={() => void onJumpSearchResult(result)} type="button">
                  跳到正文
                </button>
                <button className="secondary-action" onClick={() => void onAddSearchResult(result.paragraphId)} type="button">
                  加入引用
                </button>
              </div>
            </article>
          ))}
        </div>
      </aside>
    );
  }

  if (activePage === 'chat') {
    return (
      <section className="task-panel agent-page-panel">
        <div className="agent-page">
          <div className="agent-main">
            <div className="agent-toolbar">
              <strong>项目 Agent</strong>
              <div className="agent-toolbar-actions">
                <button className="button" onClick={onChooseAgentInstruction} type="button">
                  选择指令
                </button>
              </div>
            </div>

            <div className="agent-thread">
              {activeModelGateMessage ? (
                <div className="model-gate">
                  <strong>模型还不能执行任务</strong>
                  <span>{activeModelGateMessage}</span>
                  <button className="secondary-action" onClick={onOpenSettings} type="button">
                    去模型设置
                  </button>
                </div>
              ) : null}
              <AgentRunPanel
                result={chatAgentResult}
                status={chatAgentStatus}
                onApplyArtifact={onApplyAgentArtifact}
                onRejectArtifact={onRejectAgentArtifact}
              />
            </div>
            <AgentComposer
              agentMode={agentMode}
              instructionPreset={agentInstructionPreset}
              modelLabel={activeModelStatusText(providerStatus, hasDesktopApi)}
              referenceCount={agentExplicitReferences.length}
              taskInstruction={taskInstruction}
              setAgentMode={setAgentMode}
              setAgentInstructionPreset={setAgentInstructionPreset}
              setTaskInstruction={setTaskInstruction}
              onAddReference={onAddAgentReference}
              onChooseInstruction={onChooseAgentInstruction}
              onRun={onRunAgentChat}
            />
          </div>

          <aside className="agent-side">
            <div className="context-panel">
              <h3>已添加上下文</h3>
              {agentExplicitReferences.length > 0 ? (
                agentExplicitReferences.map((reference) => (
                  <div className="context-line" key={reference.paragraphId}>
                    <strong>@引用</strong>
                    <span>{reference.friendlyLocation}</span>
                  </div>
                ))
              ) : (
                <p className="context-empty">
                  Agent 只使用用户显式加入的上下文。添加引用会加入当前段落或当前选段；搜索结果可以从搜索页带入。
                </p>
              )}
            </div>
            <div className="mini-manuscript">
              <h3>正文对照</h3>
              {selectedParagraph ? (
                <section className="para compact active">
                  <div className="pid" title={selectedParagraph.id}>
                    {selectedParagraph.friendlyLabel.replace(/[^\d]/g, '') || selectedParagraph.index + 1}
                  </div>
                  <p className="ptext">{quickActionScope?.selectedText ?? selectedParagraph.text}</p>
                </section>
              ) : (
                <p className="empty-copy">选择段落后，这里显示对照文本。</p>
              )}
            </div>
          </aside>
        </div>
      </section>
    );
  }

  const panelCopy: Record<'polish' | 'proofread' | 'expand' | 'continuity', { title: string; body: string; action: string }> = {
    polish: {
      title: '润色',
      body: '这里处理选区或指定段落的改写。输出会以差异形式展示，不会直接覆盖原文。',
      action: '生成润色建议',
    },
	    proofread: {
	      title: '校对',
	      body: '完整校对会同时使用本地规则和当前模型。没有连接模型时，只能先做本地预筛。',
	      action: '开始校对',
	    },
    expand: {
      title: '扩写',
      body: '输入接下来发生什么、要强调哪些细节、不能改变什么，系统会生成可插入的草稿。',
      action: '生成扩写草稿',
    },
    continuity: {
      title: '检查矛盾',
      body: '检查前后设定、人物认知、物品状态、时间线和因果缺口。结果必须带证据。',
      action: '开始检查',
    },
  };

  const copy = panelCopy[activePage];
  const isTaskPage = isAiTaskPage(activePage);

  return (
    <aside className="task-panel">
      <span className="panel-kicker">{copy.title}</span>
      <h2>{copy.title}</h2>
      <p>{copy.body}</p>
      {isTaskPage ? (
	        <textarea
	          placeholder="写下你的要求、限制或重点处理内容"
	          value={taskInstruction}
	          onChange={(event) => setTaskInstruction(event.target.value)}
	        />
	      ) : null}
      {activePage === 'polish' ? (
        <section className="polish-options" aria-label="润色参数">
          <label>
            强度
            <select
              value={polishStrength}
              onChange={(event) => setPolishStrength(event.target.value as 'light' | 'medium' | 'heavy')}
            >
              <option value="light">轻度</option>
              <option value="medium">中度</option>
              <option value="heavy">重写</option>
            </select>
          </label>
          <label>
            重点
            <input
              placeholder="例如：节奏、感官、对白、去 AI 味"
              value={polishFocus}
              onChange={(event) => setPolishFocus(event.target.value)}
            />
          </label>
          <label>
            禁止改动
            <input
              placeholder="例如：不改事实、不新增设定"
              value={polishForbiddenChanges}
              onChange={(event) => setPolishForbiddenChanges(event.target.value)}
            />
          </label>
        </section>
      ) : null}
      {activePage === 'expand' ? (
        <section className="polish-options expand-options" aria-label="扩写参数">
          <label>
            前文语境
            <textarea
              placeholder="当前场景前面发生了什么"
              value={expandPreviousContext}
              onChange={(event) => setExpandPreviousContext(event.target.value)}
            />
          </label>
          <label>
            接下来发生
            <textarea
              placeholder="必须发生的事件、转折和行动"
              value={expandNextBeats}
              onChange={(event) => setExpandNextBeats(event.target.value)}
            />
          </label>
          <label>
            重点描写
            <input
              placeholder="例如：动作、五感、对白、心理压抑"
              value={expandFocusDetails}
              onChange={(event) => setExpandFocusDetails(event.target.value)}
            />
          </label>
          <label>
            禁止改动
            <input
              placeholder="例如：不改人设、不提前揭露秘密"
              value={expandForbiddenChanges}
              onChange={(event) => setExpandForbiddenChanges(event.target.value)}
            />
          </label>
          <div className="expand-inline-fields">
            <label>
              POV
              <input
                placeholder="沿用当前段落"
                value={expandPov}
                onChange={(event) => setExpandPov(event.target.value)}
              />
            </label>
            <label>
              目标长度
              <input
                placeholder="例如 800 字"
                value={expandTargetLength}
                onChange={(event) => setExpandTargetLength(event.target.value)}
              />
            </label>
          </div>
          <label>
            风格强度
            <input
              placeholder="贴近原文 / 更细腻 / 更紧凑"
              value={expandStyleStrength}
              onChange={(event) => setExpandStyleStrength(event.target.value)}
            />
          </label>
        </section>
      ) : null}
      {['continuity', 'proofread'].includes(activePage) && referenceBasket.length > 0 ? (
        <div className="reference-summary">
          <strong>已带入 {referenceBasket.length} 条引用</strong>
          {referenceBasket.slice(0, 3).map((reference) => (
            <span key={reference.paragraphId}>{reference.friendlyLocation}</span>
          ))}
        </div>
      ) : null}
      {activePage === 'proofread' ? (
        <div className="action-pair">
          <button
            className="primary-action"
            disabled={!activeModelReady}
            onClick={() => void onRunAiTaskPreflight(activePage, true)}
            type="button"
          >
            完整校对
          </button>
          <button className="secondary-action" onClick={() => void onRunLocalProofread()} type="button">
            本地预筛
          </button>
        </div>
      ) : (
        <button
          className="primary-action"
          onClick={() => void onRunAiTaskPreflight(activePage)}
          type="button"
        >
          {isTaskPage ? '准备上下文' : copy.action}
        </button>
      )}
	      {(activePage === 'polish' || activePage === 'expand' || activePage === 'continuity') && aiPreflight?.status === 'preflight_ready' ? (
	        <button
            className="secondary-action"
            disabled={activePage !== 'continuity' && !activeModelReady}
            onClick={() => void onRunAiTaskPreflight(activePage, true)}
            type="button"
          >
          {activePage === 'polish' ? '生成改写建议' : activePage === 'expand' ? '生成扩写草稿' : '生成矛盾证据卡'}
	        </button>
	      ) : null}
      {isTaskPage && activeModelGateMessage ? (
        <div className="model-gate">
          <strong>模型还不能执行任务</strong>
          <span>{activeModelGateMessage}</span>
          <button className="secondary-action" onClick={onOpenSettings} type="button">
            去模型设置
          </button>
        </div>
      ) : null}
	      {isTaskPage && activePage !== 'proofread' ? (
		          <ContextPreflightPanel
	            preflight={aiPreflight}
	            status={aiTaskStatus}
	          onAcceptCandidate={onAcceptCandidate}
	          onRejectCandidate={onRejectCandidate}
	        />
	      ) : null}
	      {activePage === 'proofread' ? (
	        <IssueListPanel issues={proofreadIssues} status={issuePanelStatus} onUpdateStatus={onUpdateProofreadIssueStatus} />
	      ) : null}
	    </aside>
	  );
	}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

type AgentAnswerBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'rule' };

function cleanAgentInlineText(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAgentAnswerBlocks(content: string): AgentAnswerBlock[] {
  const blocks: AgentAnswerBlock[] = [];
  const paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', text: cleanAgentInlineText(paragraphLines.join(' ')) });
      paragraphLines.length = 0;
    }
  };
  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ type: 'list', items: listItems });
      listItems = [];
    }
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', text: cleanAgentInlineText(heading[1]) });
      continue;
    }
    if (/^-{3,}$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'rule' });
      continue;
    }
    const listItem = line.match(/^(?:[-*]|\d+[.、])\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      listItems.push(cleanAgentInlineText(listItem[1]));
      continue;
    }
    if (line.startsWith('>')) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'quote', text: cleanAgentInlineText(line.replace(/^>\s?/, '')) });
      continue;
    }
    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function AgentAnswer({ content }: { content: string }) {
  return (
    <div className="agent-answer">
      {parseAgentAnswerBlocks(content).map((block, index) => {
        if (block.type === 'heading') {
          return <h3 key={`${block.type}-${index}`}>{block.text}</h3>;
        }
        if (block.type === 'list') {
          return (
            <ul key={`${block.type}-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item.slice(0, 18)}-${itemIndex}`}>{item}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'quote') {
          return <blockquote key={`${block.type}-${index}`}>{block.text}</blockquote>;
        }
        if (block.type === 'rule') {
          return <div className="agent-answer-rule" key={`${block.type}-${index}`} />;
        }
        return <p key={`${block.type}-${index}`}>{block.text}</p>;
      })}
    </div>
  );
}

function AgentComposer({
  agentMode,
  instructionPreset,
  modelLabel,
  referenceCount,
  taskInstruction,
  setAgentMode,
  setAgentInstructionPreset,
  setTaskInstruction,
  onAddReference,
  onChooseInstruction,
  onRun,
}: {
  agentMode: AgentUiMode;
  instructionPreset: AgentInstructionPreset;
  modelLabel: string;
  referenceCount: number;
  taskInstruction: string;
  setAgentMode: (value: AgentUiMode) => void;
  setAgentInstructionPreset: (value: AgentInstructionPreset) => void;
  setTaskInstruction: (value: string) => void;
  onAddReference: () => void;
  onChooseInstruction: () => void;
  onRun: () => Promise<void>;
}) {
  return (
    <section className="agent-composer" aria-label="Agent 输入">
      <textarea
        placeholder="描述要做的事，/ 选择指令，@ 引用上下文"
        value={taskInstruction}
        onChange={(event) => setTaskInstruction(event.target.value)}
      />
      <div className="agent-composer-foot">
        <div className="agent-mode-group">
          <div className="agent-mode-switch" aria-label="Agent 模式">
            {(['plan', 'build'] as AgentUiMode[]).map((mode) => (
              <button
                className={agentMode === mode ? 'agent-mode-button active' : 'agent-mode-button'}
                key={mode}
                onClick={() => setAgentMode(mode)}
                title={mode === 'plan' ? '先给计划和判断，不生成正文差异' : '生成候选结果，写入前仍需确认'}
                type="button"
              >
                {mode === 'plan' ? 'Plan' : 'Build'}
              </button>
            ))}
          </div>
          <span className="agent-pill">{modelLabel}</span>
          {referenceCount > 0 ? <span className="agent-pill">{referenceCount} 条引用</span> : null}
          <button
            className="agent-pill"
            onClick={() => setAgentInstructionPreset('none')}
            title="点击清空当前指令预设"
            type="button"
          >
            {agentInstructionPresets[instructionPreset].label}
          </button>
        </div>
        <div className="agent-send-group">
          <button className="composer-icon-button" onClick={onAddReference} type="button">
            添加引用
          </button>
          <button className="composer-icon-button" onClick={onChooseInstruction} type="button">
            选择指令
          </button>
          <button className="composer-send" disabled={!taskInstruction.trim()} onClick={() => void onRun()} type="button">
            运行
          </button>
        </div>
      </div>
    </section>
  );
}

function AgentArtifactPreview({ artifact }: { artifact: ChatAgentResult['artifacts'][number] }) {
  const payload = payloadRecord(artifact.payload);
  if (artifact.artifactType === 'polish_revision') {
    const beforeText = textField(payload.beforeText);
    const afterText = textField(payload.afterText);
    return (
      <div className="agent-artifact-preview">
        <span>{textField(payload.friendlyLocation)}</span>
        {beforeText && afterText ? (
          <div className="diff-list compact">
            {buildRevisionDiffRows(beforeText, afterText).map((row, index) => (
              <span key={`${row.kind}-${index}`} className={`diff-${row.kind === 'unchanged' ? 'equal' : row.kind}`}>
                {row.kind === 'removed' ? row.before : row.after}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  if (artifact.artifactType === 'expansion_draft') {
    return (
      <div className="agent-artifact-preview">
        <span>{textField(payload.friendlyLocation)}</span>
        <p>{textField(payload.draftText)}</p>
      </div>
    );
  }
  if (artifact.artifactType === 'issue_action') {
    return (
      <div className="agent-artifact-preview">
        <span>{textField(payload.issueTitle) || textField(payload.issueId)}</span>
        <p>{textField(payload.note) || textField(payload.action)}</p>
      </div>
    );
  }
  return (
    <div className="agent-artifact-preview">
      <span>{textField(payload.title)}</span>
      <p>{textField(payload.content).slice(0, 220)}</p>
    </div>
  );
}

function AgentRunPanel({
  result,
  status,
  onApplyArtifact,
  onRejectArtifact,
}: {
  result: ChatAgentResult | null;
  status: string;
  onApplyArtifact: (artifactId: string) => Promise<void>;
  onRejectArtifact: (artifactId: string) => Promise<void>;
}) {
  return (
    <section className="context-preflight agent-run-panel" aria-label="Agent 运行结果">
      <div>
        <strong>Agent 运行</strong>
        <span>{status}</span>
      </div>
      {result ? (
        <>
          <dl>
            <div>
              <dt>状态</dt>
              <dd>{result.status}</dd>
            </div>
            <div>
              <dt>工具</dt>
              <dd>{result.toolResults.length}</dd>
            </div>
            <div>
              <dt>步骤</dt>
              <dd>{result.steps.length}</dd>
            </div>
          </dl>
          {result.error ? <p className="error-text">{result.error}</p> : null}
          {result.finalAnswer ? <AgentAnswer content={result.finalAnswer} /> : null}
          {result.artifacts.length > 0 ? (
            <div className="agent-artifact-list">
              {result.artifacts.map((artifact) => (
                <article key={artifact.id} className="agent-artifact-card">
                  <strong>{artifact.title}</strong>
                  <span>{artifact.artifactType} · 等待确认</span>
                  <AgentArtifactPreview artifact={artifact} />
                  <div className="agent-artifact-actions">
                    <button className="primary-action slim" onClick={() => void onApplyArtifact(artifact.id)} type="button">
                      应用候选
                    </button>
                    <button className="secondary-action slim" onClick={() => void onRejectArtifact(artifact.id)} type="button">
                      拒绝
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
          {result.steps.length > 0 ? (
            <div className="context-source-list">
              {result.steps.map((step, index) => (
                <span key={`${step.label}-${index}`}>
                  {step.label} · {step.status}
                </span>
              ))}
            </div>
          ) : null}
          {result.toolResults.flatMap((tool) => tool.sources).length > 0 ? (
            <div className="context-source-list">
              {result.toolResults.flatMap((tool, toolResultIndex) =>
                tool.sources.map((source, index) => (
                  <span key={`${tool.toolName}-${toolResultIndex}-${source.friendlyLocation}-${index}`}>
                    {source.friendlyLocation}
                  </span>
                ))
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function ContextPreflightPanel({
  preflight,
  status,
  onAcceptCandidate,
  onRejectCandidate,
}: {
  preflight: AiTaskPreflightResult | null;
  status: string;
  onAcceptCandidate: (revisionId: string) => Promise<void>;
  onRejectCandidate: (revisionId: string) => Promise<void>;
}) {
  return (
    <section className="context-preflight" aria-label="上下文预检">
      <div>
        <strong>上下文预检</strong>
        <span>{status}</span>
      </div>
      {preflight ? (
        <>
          <dl>
            <div>
              <dt>供应商</dt>
              <dd>{preflight.providerId === 'deepseek' ? 'DeepSeek' : 'OpenRouter'}</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>{preflight.modelName}</dd>
            </div>
            <div>
              <dt>估算</dt>
              <dd>{preflight.context.tokenEstimate} tokens</dd>
            </div>
          </dl>
          <div className="context-source-list">
            <strong>来源</strong>
            {preflight.context.sourceList.length > 0 ? (
              preflight.context.sourceList.slice(0, 6).map((source) => (
                <span key={source.id}>{source.friendlyLocation ?? source.label}</span>
              ))
            ) : (
              <span>暂无正文来源</span>
            )}
          </div>
          <div className="context-omissions">
            <strong>未带入</strong>
            {preflight.context.omittedContextReasons.slice(0, 5).map((reason) => (
              <span key={`${reason.code}-${reason.detail}`}>{reason.detail}</span>
            ))}
          </div>
           {preflight.status === 'candidate_ready' ? (
             <div className="polish-candidate">
              <strong>{preflight.candidate.kind === 'polish' ? '候选改写' : '候选扩写草稿'}</strong>
              {preflight.candidate.kind === 'polish' ? (
                <>
                  <p>{preflight.candidate.editSummary}</p>
                  <div className="revision-diff" aria-label="候选改写差异">
                    <div className="revision-diff-head">
                      <span>原文</span>
                      <span>候选</span>
                    </div>
                    {buildRevisionDiffRows(preflight.candidate.beforeText, preflight.candidate.afterText).map((row, index) => (
                      <div className={`revision-diff-row ${row.kind}`} key={`${row.kind}-${index}`}>
                        <span>{row.before}</span>
                        <span>{row.after}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p>{preflight.candidate.revisionNotes || '扩写草稿已生成。'}</p>
                  <div className="draft-preview" aria-label="候选扩写草稿">
                    {preflight.candidate.paragraphs.map((paragraph, index) => (
                      <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>
                    ))}
                  </div>
                  {preflight.candidate.coveredBeats.length > 0 ? (
                    <div className="context-omissions">
                      <strong>覆盖要点</strong>
                      {preflight.candidate.coveredBeats.map((beat) => (
                        <span key={`${beat.beat}-${beat.note}`}>{`${beat.covered ? '已覆盖' : '未覆盖'}：${beat.beat}`}</span>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
              {preflight.candidate.riskFlags.length > 0 ? (
                <div className="context-omissions">
                  <strong>风险提示</strong>
                  {preflight.candidate.riskFlags.map((risk) => (
                    <span key={`${risk.type}-${risk.description}`}>{risk.description}</span>
                  ))}
                </div>
              ) : null}
              <div className="revision-actions">
                <button
                  className="primary-action"
                  onClick={() => void onAcceptCandidate(preflight.candidate.revisionId)}
                  type="button"
                >
                  接受并写入
                </button>
                <button
                  className="secondary-action"
                  onClick={() => void onRejectCandidate(preflight.candidate.revisionId)}
                  type="button"
                >
                  拒绝
                </button>
               </div>
             </div>
           ) : null}
          {preflight.status === 'issues_ready' ? (
            <div className="issue-card-list continuity-evidence-list">
              {preflight.issues.length > 0 ? (
                preflight.issues.map((issue) => (
                  <article className={`issue-card ${issue.status}`} key={issue.id}>
                    <div className="issue-card-title">
                      <strong>{issue.title}</strong>
                      <span>{statusLabel(issue.status)} / {issue.severity}</span>
                    </div>
                    <p>{issue.explanation}</p>
                    {issue.evidence.map((evidence) => (
                      <blockquote key={`${issue.id}-${evidence.role}-${evidence.paragraphId ?? evidence.quote}`}>
                        <span>{evidence.note}</span>
                        {evidence.quote}
                      </blockquote>
                    ))}
                    <p>{issue.suggestion}</p>
                  </article>
                ))
              ) : (
                <p>当前上下文没有发现已抽取事实之间的明确冲突。</p>
              )}
            </div>
          ) : null}
         </>
       ) : null}
     </section>
   );
 }

function statusLabel(status: IssueCard['status']): string {
  const labels: Record<IssueCard['status'], string> = {
    open: '待处理',
    fixed: '已处理',
    ignored: '已忽略',
    false_positive: '误报',
    marked_as_foreshadowing: '伏笔',
    marked_as_lie: '角色撒谎',
    marked_as_unreliable_narration: '不可靠叙述',
    author_confirmed_exception: '作者确认例外',
  };
  return labels[status];
}

function IssueListPanel({
  issues,
  status,
  onUpdateStatus,
}: {
  issues: IssueCard[];
  status: string;
  onUpdateStatus: (issueId: string, status: IssueCard['status']) => Promise<void>;
}) {
  return (
    <section className="issue-list-panel" aria-label="校对问题卡">
      <div className="issue-list-head">
        <strong>问题卡</strong>
        <span>{status}</span>
      </div>
      {issues.length > 0 ? (
        <div className="issue-card-list">
          {issues.map((issue) => (
            <article className={`issue-card ${issue.status}`} key={issue.id}>
              <div className="issue-card-title">
                <strong>{issue.title}</strong>
                <span>{statusLabel(issue.status)} / {issue.severity}</span>
              </div>
              <p>{issue.explanation}</p>
              {issue.evidence[0] ? (
                <blockquote>
                  <span>{issue.evidence[0].note}</span>
                  {issue.evidence[0].quote}
                </blockquote>
              ) : null}
              <p>{issue.suggestion}</p>
              <div className="issue-actions">
                <button className="secondary-action" onClick={() => void onUpdateStatus(issue.id, 'fixed')} type="button">
                  标记已处理
                </button>
                <button className="secondary-action" onClick={() => void onUpdateStatus(issue.id, 'ignored')} type="button">
                  忽略
                </button>
                <button className="secondary-action" onClick={() => void onUpdateStatus(issue.id, 'false_positive')} type="button">
                  误报
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p>运行完整校对或本地预筛后，问题会按段落和证据列在这里。</p>
      )}
    </section>
  );
}
