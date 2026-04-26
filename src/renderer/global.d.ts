import type { NovelToolApi } from '../shared/preload-api';

declare global {
  interface Window {
    novelTool?: NovelToolApi;
  }
}
