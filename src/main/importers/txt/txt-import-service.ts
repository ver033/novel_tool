import crypto from 'node:crypto';
import Database from 'better-sqlite3';

import { createJobQueue } from '../../jobs/job-queue';
import { createProject } from '../../projects/project-service';
import { commitTxtImport, previewTxtImport, type CommitTxtImportResult, type TxtImportPreview } from './txt-importer';

export interface TxtPreviewResult {
  previewId: string;
  preview: TxtImportPreview;
}

export interface CommitTxtPreviewInput {
  previewId: string;
  baseDirectory: string;
  projectName: string;
}

export interface CommitTxtPreviewResult extends CommitTxtImportResult {
  projectPath: string;
  dbPath: string;
}

export function createTxtImportService() {
  const previews = new Map<string, TxtImportPreview>();

  return {
    async previewTxt(filePath: string): Promise<TxtPreviewResult> {
      const preview = await previewTxtImport(filePath);
      const previewId = `txt-preview-${crypto.randomUUID()}`;
      previews.set(previewId, preview);
      return { previewId, preview };
    },

    async commitTxt(input: CommitTxtPreviewInput): Promise<CommitTxtPreviewResult> {
      const preview = previews.get(input.previewId);
      if (!preview) {
        throw new Error('TXT import preview is missing or expired');
      }

      const project = await createProject({
        baseDirectory: input.baseDirectory,
        projectName: input.projectName,
      });
      const db = new Database(project.dbPath);
      try {
        const result = await commitTxtImport({
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
