import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const appSource = readFileSync(path.join(process.cwd(), 'src', 'renderer', 'App.tsx'), 'utf8');

describe('global page wiring contract', () => {
  test('does not route implemented global/export actions through pending-feature placeholders', () => {
    expect(appSource).not.toContain("onPendingFeature('Markdown 大纲导入')");
    expect(appSource).not.toContain("onPendingFeature('确认选中记忆')");
    expect(appSource).not.toContain("onPendingFeature('聚焦铜钥匙冲突')");
    expect(appSource).not.toContain("onPendingFeature('开始导出')");
  });

  test('routes picked EPUB files into the EPUB preview path', () => {
    expect(appSource).toContain('previewEpub(picked.filePath)');
    expect(appSource).not.toContain('EPUB 导入会在后续阶段接入；当前阶段先完成 TXT');
  });

  test('offers an executable continuity evidence-card action after context preflight', () => {
    expect(appSource).toContain("activePage === 'continuity'");
    expect(appSource).toContain('生成矛盾证据卡');
  });

  test('wires visible model-setting actions instead of pending placeholders', () => {
    expect(appSource).not.toContain("onPendingFeature('删除本机密钥')");
    expect(appSource).not.toContain("onPendingFeature('恢复推荐模型配置')");
    expect(appSource).not.toContain("onPendingFeature('复制模型配置到所有项目')");
    expect(appSource).not.toContain('复制模型配置到所有项目');
    expect(appSource).toContain('deleteProviderKey');
    expect(appSource).toContain('restoreRecommendedTaskModelProfile');
  });

  test('does not render decorative or unavailable chips as enabled dead buttons', () => {
    expect(appSource).not.toContain('onClick={index === 0 ? onOpenProject : undefined}');
    expect(appSource).not.toContain('<button className="chip-button"');
  });
});
