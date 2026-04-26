import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'src/renderer/App.tsx'), 'utf8');
const styles = readFileSync(join(process.cwd(), 'src/renderer/styles.css'), 'utf8');

describe('agent page layout contract', () => {
  test('keeps the agent composer anchored under the thread with explicit context beside it', () => {
    expect(appSource).toContain('className="agent-main"');
    expect(appSource).toContain('className="agent-thread"');
    expect(appSource).toContain('className="agent-side"');
    expect(appSource).toContain('Agent 只使用用户显式加入的上下文');
    expect(appSource).toContain('添加引用会加入当前段落或当前选段');
    expect(appSource).not.toContain('添加章节、角色、记忆、时间线或搜索结果');
  });

  test('uses the prototype agent grid instead of a generic task panel stack', () => {
    expect(styles).toContain('.agent-page {');
    expect(styles).toContain('grid-template-columns: minmax(420px, 1fr) minmax(220px, 280px)');
    expect(styles).toContain('grid-template-rows: auto minmax(0, 1fr) auto');
  });

  test('keeps the workspace constrained to the viewport so the agent composer remains visible', () => {
    expect(styles).toContain('.workspace-view {\n  height: calc(100dvh - 116px);');
    expect(styles).toContain('.agent-page-panel {\n  align-content: stretch;\n  overflow: hidden;');
  });

  test('does not duplicate the agent context side panel with the workspace inspector', () => {
    expect(appSource).toContain("className={activePage === 'chat' ? 'workspace-view chat-workspace' : 'workspace-view'}");
    expect(styles).toContain('.chat-workspace {\n  grid-template-columns: 56px 276px minmax(620px, 1fr);');
    expect(styles).toContain('.chat-workspace .workspace-inspector {\n  display: none;');
  });

  test('routes search references into the agent explicit context when using ask action', () => {
    expect(appSource).toContain("if (target === 'chat') {");
    expect(appSource).toContain('setAgentExplicitReferences(referenceBasket);');
  });

  test('renders agent answers as readable blocks instead of raw markdown text', () => {
    expect(appSource).toContain('<AgentAnswer content={result.finalAnswer} />');
    expect(styles).toContain('.agent-answer {');
    expect(styles).toContain('.agent-answer h3 {');
  });

  test('uses stable unique keys for repeated agent tool sources', () => {
    expect(appSource).toContain('result.toolResults.flatMap((tool, toolResultIndex)');
    expect(appSource).toContain('`${tool.toolName}-${toolResultIndex}-${source.friendlyLocation}-${index}`');
  });

  test('does not clip the composer at the narrow prototype viewport', () => {
    expect(styles).toContain('.agent-page {\n    grid-template-columns: minmax(0, 1fr);');
    expect(styles).toContain('.agent-side {\n    display: none;');
  });
});
