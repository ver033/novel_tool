/// <reference types="vite/client" />

import type { NovelToolApi } from "../preload/api";

declare global {
  interface Window {
    api?: NovelToolApi;
    novelTool?: NovelToolApi;
  }
}
