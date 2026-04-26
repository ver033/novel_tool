import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { analyzeProjectCanon, importMarkdownCanon, listMarkdownCanon } from '../../../src/main/canon/canon-service';
import { createTxtImportService } from '../../../src/main/importers/txt/txt-import-service';
import { createProject } from '../../../src/main/projects/project-service';

async function importTestNovel() {
  const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-canon-analyze-'));
  const service = createTxtImportService();
  const preview = await service.previewTxt(path.join(process.cwd(), 'test_novel', 'test.txt'));
  return service.commitTxt({
    previewId: preview.previewId,
    baseDirectory: root,
    projectName: preview.preview.suggestedProjectName,
  });
}

function createMockCanonModelRequest(overrides: Partial<Record<string, string>> = {}) {
  const documents = [
    {
      file_name: '00-project-overview.md',
      markdown: [
        '# 项目概览',
        '- 项目标题：test',
        '- 项目语言：简体中文',
        '- 核心承诺：落魄天才在宗族压力和未知戒指秘密中重新找回尊严。[来源：第1章 陨落的天才]',
        '- 主要钩子：斗气倒退、黑色古戒、贵客来访。',
      ].join('\n'),
    },
    {
      file_name: '01-theme-and-proposition.md',
      markdown: [
        '# 主题与命题',
        '- 中心问题：失去天才身份后，人如何重新确认自我价值。',
        '- 人物代价：尊严、亲情压力和被族人排斥的孤立感。',
      ].join('\n'),
    },
    {
      file_name: '02-worldbuilding.md',
      markdown: [
        '# 世界观',
        '- 时代与地点框架：斗气大陆、乌坦城萧家。',
        '- 规则与限制：斗之气十段后才能凝聚斗之气旋，功法分天地玄黄。',
        '- 不可发生之事：没有斗者资格时无法进入斗气阁寻找功法。',
      ].join('\n'),
    },
    {
      file_name: '03-cast-bible.md',
      markdown: [
        '# 角色人设',
        '## 萧炎',
        '- role in story：失去天才光环的主角。',
        '- visible goal：一年后斗之气达到七段，避免被分配到家族产业。',
        '- hidden need：确认斗气消失的原因并重新建立尊严。',
        '- fear / shame / debt：害怕继续拖累父亲，也羞于昔日天才变废物。',
        '- speech signature：自嘲、压抑，但对父亲仍保持克制。',
      ].join('\n'),
    },
    {
      file_name: '04-relationship-map.md',
      markdown: [
        '# 关系图谱',
        '## 萧炎 / 萧薰儿',
        '- current state：萧薰儿仍尊敬并鼓励萧炎。',
        '- hidden tension：萧炎因落魄而抗拒被亲近。',
        '- unresolved debt：薰儿对萧炎的信任需要后续回应。',
      ].join('\n'),
    },
    {
      file_name: '05-main-plotlines.md',
      markdown: [
        '# 主线与支线',
        '## 主线：斗气倒退与尊严重建',
        '- core conflict：萧炎斗气不断消失，宗族评价持续下压。',
        '- current objective：在一年期限内恢复到七段斗之气。',
        '- current obstacle：黑色古戒疑似吞噬斗气但尚未被确认。',
      ].join('\n'),
    },
    {
      file_name: '06-foreshadow-ledger.md',
      markdown: [
        '# 伏笔台账',
        '## 黑色古戒微光',
        '- planted in chapter：第2章与第3章。',
        '- surface form：戒指在无人察觉时微微发光。',
        '- hidden meaning：可能关联斗气消失。',
        '- expected payoff window：近期揭示。',
      ].join('\n'),
    },
    {
      file_name: '07-chapter-roadmap.md',
      markdown: [
        '# 章节路线图',
        '## 第1章 陨落的天才',
        '- stage target：展示萧炎的低谷、族人嘲讽和薰儿支持。',
        '- key conflict：天才身份和现实评价冲突。',
        '## 第2章 斗气大陆',
        '- stage target：补足世界规则和萧炎秘密。',
      ].join('\n'),
    },
    {
      file_name: '08-dynamic-state.md',
      markdown: [
        '# 动态状态',
        '- 当前章节进度：萧炎被测出斗之力三段，成年仪式压力逼近。',
        '- 已公开事实：族人知道他斗气低迷；萧炎穿越身份仍是秘密。',
        '- 角色状态变化：萧炎从公开受辱转向私下追查自身异常。',
      ].join('\n'),
    },
    {
      file_name: '09-style-guide.md',
      markdown: [
        '# 风格指南',
        '- paragraph mode：web-serial-natural。',
        '- narrative distance：贴近萧炎的羞辱感、自嘲和压抑。',
        '- language taboos：不要把人物困境改成抽象励志口号。',
      ].join('\n'),
    },
  ];
  for (const doc of documents) {
    doc.markdown = overrides[doc.file_name] ?? doc.markdown;
  }

  return {
    model: 'deepseek-v4-pro',
    reasoningEffort: 'high' as const,
    thinkingMode: 'enabled' as const,
    sendModelRequest: async () => ({
      content: JSON.stringify({ documents }),
      reasoningContent: null,
      toolCalls: [],
    }),
  };
}

describe('canon markdown import service', () => {
  test('copies markdown into project planning data and writes parsed outline records', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-canon-'));
    const project = await createProject({ baseDirectory: root, projectName: '潮门旧案' });
    const markdownPath = path.join(root, 'outline.md');
    await writeFile(
      markdownPath,
      [
        '# 卷二：潮汐线',
        '',
        '## 第十章 雨夜问讯',
        '- 陈砚公开丢弃铜钥匙',
        '- 林照确认旧港灯塔记录缺页',
        '',
        '## 伏笔：铜钥匙黑泥',
        '- 预期在第十五章回收',
      ].join('\n')
    );

    const result = await importMarkdownCanon({
      projectPath: project.projectPath,
      dbPath: project.dbPath,
      filePath: markdownPath,
    });

    expect(result.fileName).toBe('outline.md');
    expect(result.copiedPath).toContain(`${path.sep}outlines${path.sep}`);
    expect(result.recordCount).toBe(3);
    expect(result.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          headingPath: '卷二：潮汐线 > 第十章 雨夜问讯',
          recordType: 'chapter_roadmap',
          text: expect.stringContaining('陈砚公开丢弃铜钥匙'),
          status: 'ai_extracted',
        }),
        expect.objectContaining({
          headingPath: '卷二：潮汐线 > 伏笔：铜钥匙黑泥',
          recordType: 'foreshadowing',
        }),
      ])
    );

    const db = new Database(project.dbPath);
    try {
      const source = db.prepare('SELECT file_name, source_kind FROM canon_sources WHERE id = ?').get(result.sourceId) as
        | Record<string, unknown>
        | undefined;
      const recordCount = db.prepare('SELECT COUNT(*) AS count FROM outline_records WHERE source_id = ?').get(result.sourceId) as
        | { count: number }
        | undefined;
      expect(source).toEqual({ file_name: 'outline.md', source_kind: 'markdown_outline' });
      expect(recordCount?.count).toBe(3);
    } finally {
      db.close();
    }
  });

  test('lists previously imported markdown canon records for reopened projects', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-canon-list-'));
    const project = await createProject({ baseDirectory: root, projectName: '长夜设定' });
    const markdownPath = path.join(root, 'outline.md');
    await writeFile(
      markdownPath,
      [
        '# 角色人设',
        '',
        '## 主角',
        '- 目标：守住最后一座灯塔',
        '',
        '# 世界规则',
        '',
        '## 灯塔',
        '- 灯塔熄灭后，岛上的时间会停止。',
      ].join('\n')
    );

    const imported = await importMarkdownCanon({
      projectPath: project.projectPath,
      dbPath: project.dbPath,
      filePath: markdownPath,
    });

    const listed = listMarkdownCanon(project.dbPath);

    expect(listed.sources).toEqual([
      expect.objectContaining({
        fileName: 'outline.md',
        sourceKind: 'markdown_outline',
        recordCount: imported.recordCount,
      }),
    ]);
    expect(imported.recordCount).toBe(4);
    expect(listed.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          headingPath: '角色人设 > 主角',
          recordType: 'character',
          sourceFileName: 'outline.md',
          text: expect.stringContaining('守住最后一座灯塔'),
        }),
        expect.objectContaining({
          headingPath: '世界规则 > 灯塔',
          recordType: 'world_rule',
          sourceFileName: 'outline.md',
        }),
      ])
    );
  });

  test('analyzes a project into the novel-control-station 00-09 control documents and parsed records', async () => {
    const project = await importTestNovel();

    const analyzed = await analyzeProjectCanon({
      projectPath: project.projectPath,
      dbPath: project.dbPath,
      modelRequest: createMockCanonModelRequest(),
    });

    expect(analyzed.sourceKind).toBe('generated_control_doc');
    expect(analyzed.fileNames).toEqual([
      '00-project-overview.md',
      '01-theme-and-proposition.md',
      '02-worldbuilding.md',
      '03-cast-bible.md',
      '04-relationship-map.md',
      '05-main-plotlines.md',
      '06-foreshadow-ledger.md',
      '07-chapter-roadmap.md',
      '08-dynamic-state.md',
      '09-style-guide.md',
    ]);
    expect(analyzed.recordCount).toBeGreaterThanOrEqual(10);
    expect(analyzed.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          headingPath: expect.stringContaining('第1章'),
          recordType: 'chapter_roadmap',
          text: expect.stringContaining('低谷'),
        }),
        expect.objectContaining({
          headingPath: expect.stringContaining('风格指南'),
          recordType: 'style',
        }),
        expect.objectContaining({
          headingPath: expect.stringContaining('主线与支线'),
          recordType: 'plotline',
        }),
        expect.objectContaining({
          headingPath: '项目概览',
          recordType: 'overview',
        }),
        expect.objectContaining({
          headingPath: '主题与命题',
          recordType: 'theme',
        }),
        expect.objectContaining({
          headingPath: '动态状态',
          recordType: 'dynamic_state',
        }),
      ])
    );

    const overview = await readFile(path.join(project.projectPath, 'canon', '00-project-overview.md'), 'utf8');
    expect(overview).toContain('项目语言：简体中文');
    expect(overview).toContain('核心承诺：');
    expect(overview).not.toContain('章节数量：');

    const cast = await readFile(path.join(project.projectPath, 'canon', '03-cast-bible.md'), 'utf8');
    expect(cast).toContain('明面目标：一年后斗之气达到七段');
    expect(cast).toContain('内在需求：确认斗气消失的原因');

    const listed = listMarkdownCanon(project.dbPath);
    expect(listed.sources).toHaveLength(10);
    expect(listed.sources[0]).toEqual(
      expect.objectContaining({
        sourceKind: 'generated_control_doc',
      })
    );
    expect(listed.records.some((record) => record.sourceFileName === '07-chapter-roadmap.md')).toBe(true);
  });

  test('normalizes generated character labels and paragraph ids into writer-facing Chinese text', async () => {
    const project = await importTestNovel();
    const db = new Database(project.dbPath);
    let paragraph: Record<string, unknown>;
    try {
      paragraph = db
        .prepare(
          `SELECT paragraphs.id, paragraphs.paragraph_index, chapters.title
           FROM paragraphs
           JOIN chapters ON chapters.id = paragraphs.chapter_id
           WHERE paragraphs.text LIKE '%萧炎，斗之力，三段%'
           LIMIT 1`
        )
        .get() as Record<string, unknown>;
    } finally {
      db.close();
    }
    const paragraphId = String(paragraph.id);
    const paragraphPrefix = /^para-\d{4}-\d{4}/.exec(paragraphId)?.[0] ?? paragraphId;
    const friendlyLocation = `${String(paragraph.title)} / 第 ${Number(paragraph.paragraph_index) + 1} 段`;

    await analyzeProjectCanon({
      projectPath: project.projectPath,
      dbPath: project.dbPath,
      modelRequest: createMockCanonModelRequest({
        '03-cast-bible.md': [
          '# 角色人设',
          '## 萧炎',
          '- **role**：主角，萧家三少爷，15岁。',
          `- **visible goal**：一年内将斗之气提升至七段，通过成年仪式获得进入斗气阁资格（${paragraphPrefix}, ${paragraphId}）。`,
          '- **hidden need**：找回自尊，查清斗气消失真相。',
          '- **fear/shame/debt**：害怕再次辜负父亲期望。',
          '- **speech signature**：自嘲尖锐，对亲近之人温暖。',
          '- **arc direction**：从颓废自嘲到逐渐觉醒。',
        ].join('\n'),
      }),
    });

    const cast = await readFile(path.join(project.projectPath, 'canon', '03-cast-bible.md'), 'utf8');

    expect(cast).toContain('角色定位：主角，萧家三少爷，15岁');
    expect(cast).toContain('明面目标：一年内将斗之气提升至七段');
    expect(cast).toContain('内在需求：找回自尊');
    expect(cast).toContain('恐惧 / 羞耻 / 债：害怕再次辜负父亲期望');
    expect(cast).toContain('说话方式：自嘲尖锐');
    expect(cast).toContain('变化方向：从颓废自嘲到逐渐觉醒');
    expect(cast).toContain(friendlyLocation);
    expect(cast).not.toMatch(/\brole\b/i);
    expect(cast).not.toMatch(/visible goal/i);
    expect(cast).not.toContain(paragraphPrefix);
    expect(cast).not.toContain(paragraphId);
  });

  test('reanalyzing generated control documents replaces the previous generated source records', async () => {
    const project = await importTestNovel();

    await analyzeProjectCanon({
      projectPath: project.projectPath,
      dbPath: project.dbPath,
      modelRequest: createMockCanonModelRequest(),
    });
    await analyzeProjectCanon({
      projectPath: project.projectPath,
      dbPath: project.dbPath,
      modelRequest: createMockCanonModelRequest(),
    });

    const listed = listMarkdownCanon(project.dbPath);
    expect(listed.sources).toHaveLength(10);
    expect(listed.sources.every((source) => source.sourceKind === 'generated_control_doc')).toBe(true);
  });

  test('does not surface legacy placeholder generated docs as current canon', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-canon-legacy-'));
    const project = await createProject({ baseDirectory: root, projectName: '旧占位设定' });
    const db = new Database(project.dbPath);
    try {
      db.prepare(
        `INSERT INTO canon_sources (id, file_name, source_path, source_kind, imported_at, content_hash)
         VALUES ('legacy-source', '00-project-overview.md', '/tmp/00-project-overview.md', 'generated_control_doc', '2026-04-25T00:00:00.000Z', 'legacy')`
      ).run();
      db.prepare(
        `INSERT INTO outline_records (id, source_id, heading_path, record_type, text, status, created_at)
         VALUES ('legacy-record', 'legacy-source', '项目概览', 'overview', ?, 'ai_extracted', '2026-04-25T00:00:00.000Z')`
      ).run(
        [
          '- 操作模式：作者控制的本地写作工作台',
          '- 章节数量：5',
          '- 文档状态：由“分析项目”根据当前正文和已确认记忆生成，待作者确认',
        ].join('\n')
      );
    } finally {
      db.close();
    }

    const listed = listMarkdownCanon(project.dbPath);

    expect(listed.sources).toHaveLength(0);
    expect(listed.records).toHaveLength(0);
  });

  test('project analysis requires an explicit model request instead of deterministic placeholder docs', async () => {
    const project = await importTestNovel();

    await expect(
      analyzeProjectCanon({
        projectPath: project.projectPath,
        dbPath: project.dbPath,
      })
    ).rejects.toThrow('全局设定分析需要可用模型');
  });
});
