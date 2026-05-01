import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shouldIgnorePackageFile, shouldPackageRuntimeFile } from "../../forge.config";

const rootDir = process.cwd();

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

describe("phase 0 desktop skeleton", () => {
  it("uses the Electron Forge Vite file layout from the official plugin docs", () => {
    const requiredFiles = [
      "forge.config.ts",
      "vite.main.config.ts",
      "vite.preload.config.ts",
      "vite.renderer.config.ts",
      "src/main/index.ts",
      "src/preload/index.ts",
      "src/preload/api.ts",
      "src/renderer/App.tsx",
      "src/renderer/index.html",
      "src/renderer/renderer.tsx",
      "src/renderer/styles/globals.css",
    ];

    expect(requiredFiles.filter((file) => !existsSync(join(rootDir, file)))).toEqual([]);
  });

  it("keeps package scripts and main entry aligned with Electron Forge", () => {
    const pkg = readJson<{
      main?: string;
      scripts?: Record<string, string>;
    }>(join(rootDir, "package.json"));

    expect(pkg.main).toBe(".vite/build/index.js");
    expect(pkg.scripts).toMatchObject({
      predev: "npm run rebuild:electron",
      dev: "electron-forge start",
      prebuild: "npm run rebuild:electron",
      build: "electron-forge package",
      prepackage: "npm run rebuild:electron",
      premake: "npm run rebuild:electron",
      "premake:windows": "npm run rebuild:electron",
      "make:windows": "electron-forge make --platform=win32 --arch=x64 --targets=squirrel",
      typecheck: "tsc --noEmit",
      pretest: "npm run rebuild:node",
      test: "vitest run --testTimeout=30000 --exclude 'tests/e2e/**'",
      "test:e2e": "playwright test tests/e2e",
      "check:lockfile-safety": "node scripts/check-lockfile-safety.mjs",
    });
  });

  it("builds the preload bundle at the path BrowserWindow loads", () => {
    const mainSource = readFileSync(join(rootDir, "src/main/index.ts"), "utf8");
    const preloadConfig = readFileSync(join(rootDir, "vite.preload.config.ts"), "utf8");

    expect(mainSource).toContain('path.join(__dirname, "preload.js")');
    expect(preloadConfig).toContain('entryFileNames: "preload.js"');
  });

  it("packages native runtime dependencies used by the main process", () => {
    const forgeConfig = readFileSync(join(rootDir, "forge.config.ts"), "utf8");

    expect(forgeConfig).toContain('unpack: "**/*.node"');
    expect(forgeConfig).toContain('"node_modules/better-sqlite3"');
    expect(forgeConfig).toContain('"node_modules/bindings"');
    expect(forgeConfig).toContain('"node_modules/file-uri-to-path"');
  });

  it("keeps native dependency parent directories traversable during packaging", () => {
    expect(shouldPackageRuntimeFile("/package.json")).toBe(true);
    expect(shouldPackageRuntimeFile("/.vite")).toBe(true);
    expect(shouldPackageRuntimeFile("/node_modules")).toBe(true);
    expect(shouldPackageRuntimeFile("/node_modules/better-sqlite3")).toBe(true);
    expect(shouldPackageRuntimeFile("/node_modules/better-sqlite3/build/Release/better_sqlite3.node")).toBe(true);
    expect(shouldPackageRuntimeFile("/node_modules/left-pad")).toBe(false);
    expect(shouldPackageRuntimeFile("/src/main/index.ts")).toBe(false);
  });

  it("does not ignore the package root during Electron Packager copy", () => {
    expect(shouldIgnorePackageFile("")).toBe(false);
    expect(shouldIgnorePackageFile("/package.json")).toBe(false);
    expect(shouldIgnorePackageFile("/node_modules")).toBe(false);
    expect(shouldIgnorePackageFile("/src/main/index.ts")).toBe(true);
  });
});
