export interface StatusStripJob {
  type: string;
  status: string;
  progress: number;
  error?: string | null;
}

export interface StatusStripInput {
  cursorStatus: string;
  hasDesktopApi: boolean;
  latestJob: StatusStripJob | null | undefined;
  status: string;
}

export interface StatusStripModel {
  saveStatus: string;
  cursorStatus: string;
  queueStatus: string;
  errorStatus: string;
  queueTone: 'ok' | 'warn';
}

export function buildStatusStripModel(input: StatusStripInput): StatusStripModel {
  const queueStatus = input.latestJob
    ? `任务：${input.latestJob.type} / ${input.latestJob.status} / ${input.latestJob.progress}%`
    : '队列空闲';

  return {
    saveStatus: input.status,
    cursorStatus: input.cursorStatus,
    queueStatus,
    errorStatus: input.latestJob?.error ?? '无错误',
    queueTone: input.latestJob || !input.hasDesktopApi ? 'warn' : 'ok',
  };
}
