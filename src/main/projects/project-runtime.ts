import { access } from 'node:fs/promises';
import path from 'node:path';

import { createProject, type CreateProjectInput, type ProjectHandle } from './project-service';

export interface CurrentProject extends ProjectHandle {
  name: string;
}

let currentProject: CurrentProject | null = null;

export async function createAndSetCurrentProject(input: CreateProjectInput): Promise<CurrentProject> {
  const handle = await createProject(input);
  currentProject = {
    ...handle,
    name: path.basename(handle.projectPath, '.novelproj'),
  };
  return currentProject;
}

export async function openAndSetCurrentProject(projectPath: string): Promise<CurrentProject> {
  if (!projectPath.endsWith('.novelproj')) {
    throw new Error('请选择 .novelproj 项目文件夹');
  }

  const dbPath = path.join(projectPath, 'book.db');
  await access(dbPath);

  currentProject = {
    projectPath,
    dbPath,
    name: path.basename(projectPath, '.novelproj'),
  };
  return currentProject;
}

export function getCurrentProject(): CurrentProject | null {
  return currentProject;
}

export function requireCurrentProject(): CurrentProject {
  if (!currentProject) {
    throw new Error('请先新建或打开一个本地项目');
  }

  return currentProject;
}
