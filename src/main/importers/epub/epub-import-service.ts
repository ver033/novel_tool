import crypto from 'node:crypto';
import Database from 'better-sqlite3';

import { createJobQueue } from '../../jobs/job-queue';
import { createProject } from '../../projects/project-service';
import {
  commitEpubImport,
  previewEpubImport,
  type CommitEpubImportResult,
  type EpubImportPreview,
} from './epub-importer';

export interface EpubPreviewResult {
  previewId: string;
  preview: EpubImportPreview;
}

export interface CommitEpubPreviewInput {
  previewId: string;
  baseDirectory: string;
  projectName: string;
}

export interface CommitEpubPreviewResult extends CommitEpubImportResult {
  projectPath: string;
  dbPath: string;
}

export function createEpubImportService() {
  const previews = new Map<string, EpubImportPreview>();

  return {
    async previewEpub(filePath: string): Promise<EpubPreviewResult> {
      const preview = await previewEpubImport(filePath);
      const previewId = `epub-preview-${crypto.randomUUID()}`;
      previews.set(previewId, preview);
      return { previewId, preview };
    },

    async commitEpub(input: CommitEpubPreviewInput): Promise<CommitEpubPreviewResult> {
      const preview = previews.get(input.previewId);
      if (!preview) {
        throw new Error('EPUB import preview is missing or expired');
      }

      const project = await createProject({
        baseDirectory: input.baseDirectory,
        projectName: input.projectName,
      });
      const db = new Database(project.dbPath);
      try {
        const result = await commitEpubImport({
          projectPath: project.projectPath,
          db,
          queue: createJobQueue(db),
          preview,
        });
        previews.delete(input.previewId);
        return {
          ...project,
          ...result,
        };
      } finally {
        db.close();
      }
    },
  };
}
