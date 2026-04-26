import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';

import { createEpubImportService } from '../../../src/main/importers/epub/epub-import-service';
import { getChapterForEditing, listChaptersForProject } from '../../../src/main/manuscript/manuscript-service';
import { searchParagraphs } from '../../../src/main/search/search-service';

async function writeFixtureEpub(filePath: string) {
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
       <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
         <rootfiles>
           <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
         </rootfiles>
       </container>`
    ),
    'OEBPS/content.opf': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
       <package version="3.0" xmlns="http://www.idpf.org/2007/opf">
         <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
           <dc:title>潮门旧案</dc:title>
         </metadata>
         <manifest>
           <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
           <item id="chap2" href="chap2.xhtml" media-type="application/xhtml+xml"/>
         </manifest>
         <spine>
           <itemref idref="chap1"/>
           <itemref idref="chap2"/>
         </spine>
       </package>`
    ),
    'OEBPS/chap1.xhtml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
       <html xmlns="http://www.w3.org/1999/xhtml"><body>
         <h1>第一章 雨夜</h1>
         <p>林照在旧港雨夜醒来。</p>
         <p>铜钥匙贴着掌心发冷。</p>
       </body></html>`
    ),
    'OEBPS/chap2.xhtml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
       <html xmlns="http://www.w3.org/1999/xhtml"><body>
         <h1>第二章 潮门</h1>
         <p>潮门信号灯亮起。</p>
       </body></html>`
    ),
  };
  await writeFile(filePath, Buffer.from(zipSync(files)));
}

async function writeEpubWithEmptySpineEntry(filePath: string) {
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
       <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
         <rootfiles>
           <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
         </rootfiles>
       </container>`
    ),
    'OEBPS/content.opf': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
       <package version="3.0" xmlns="http://www.idpf.org/2007/opf">
         <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
           <dc:title>空导航测试</dc:title>
         </metadata>
         <manifest>
           <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/>
           <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
         </manifest>
         <spine>
           <itemref idref="nav"/>
           <itemref idref="chap1"/>
         </spine>
       </package>`
    ),
    'OEBPS/nav.xhtml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
       <html xmlns="http://www.w3.org/1999/xhtml"><body>
         <h1>目录</h1>
       </body></html>`
    ),
    'OEBPS/chap1.xhtml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
       <html xmlns="http://www.w3.org/1999/xhtml"><body>
         <h1>正文第一章</h1>
         <p>真正的正文从这里开始。</p>
       </body></html>`
    ),
  };
  await writeFile(filePath, Buffer.from(zipSync(files)));
}

describe('EPUB import service', () => {
  test('previews and commits a non-DRM EPUB in spine order', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-epub-'));
    const epubPath = path.join(root, 'fixture.epub');
    await writeFixtureEpub(epubPath);
    const service = createEpubImportService();

    const preview = await service.previewEpub(epubPath);
    const commit = await service.commitEpub({
      previewId: preview.previewId,
      baseDirectory: root,
      projectName: preview.preview.suggestedProjectName,
    });
    const chapters = listChaptersForProject(commit.dbPath);
    const firstChapter = getChapterForEditing(commit.dbPath, chapters[0].id);
    const search = searchParagraphs(commit.dbPath, { query: '铜钥匙', limit: 5 });

    expect(preview.preview).toMatchObject({
      fileName: 'fixture.epub',
      suggestedProjectName: '潮门旧案',
      detectedEncoding: 'EPUB',
    });
    expect(preview.preview.chapters.map((chapter) => chapter.title)).toEqual(['第一章 雨夜', '第二章 潮门']);
    expect(preview.preview.chapters[0].paragraphs).toEqual(['林照在旧港雨夜醒来。', '铜钥匙贴着掌心发冷。']);
    expect(commit).toMatchObject({
      chapterCount: 2,
      paragraphCount: 3,
    });
    expect(chapters.map((chapter) => chapter.title)).toEqual(['第一章 雨夜', '第二章 潮门']);
    expect(firstChapter.paragraphs[1]).toMatchObject({
      text: '铜钥匙贴着掌心发冷。',
      friendlyLabel: '第 2 段',
    });
    expect(search.results[0].text).toContain('铜钥匙');

    const db = new Database(commit.dbPath);
    try {
      const sourceTypes = db.prepare('SELECT DISTINCT source_type FROM chapters').all() as Array<Record<string, unknown>>;
      expect(sourceTypes).toEqual([{ source_type: 'epub' }]);
    } finally {
      db.close();
    }
  });

  test('skips empty spine entries so imported projects open on real manuscript chapters', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'novel-tool-epub-empty-'));
    const epubPath = path.join(root, 'empty-spine.epub');
    await writeEpubWithEmptySpineEntry(epubPath);
    const service = createEpubImportService();

    const preview = await service.previewEpub(epubPath);
    const commit = await service.commitEpub({
      previewId: preview.previewId,
      baseDirectory: root,
      projectName: preview.preview.suggestedProjectName,
    });
    const chapters = listChaptersForProject(commit.dbPath);

    expect(preview.preview.chapters.map((chapter) => chapter.title)).toEqual(['正文第一章']);
    expect(preview.preview.warnings).toContain('skipped_empty_spine_entry');
    expect(commit).toMatchObject({
      chapterCount: 1,
      paragraphCount: 1,
    });
    expect(chapters.map((chapter) => chapter.title)).toEqual(['正文第一章']);
    expect(chapters[0]).toMatchObject({
      index: 0,
      paragraphCount: 1,
    });
  });
});
