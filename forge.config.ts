import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { flipFuses, FuseV1Options, FuseVersion } from "@electron/fuses";
import path from "node:path";

const packagedRuntimeDependencyRoots = [
  ".vite",
  "package.json",
  "node_modules/better-sqlite3",
  "node_modules/bindings",
  "node_modules/file-uri-to-path"
];
const appBundleName = "墨枢";
const executableName = "novel-tool";
const appIconPath = path.resolve(__dirname, "build", "icon");
const windowsSetupIconPath = path.resolve(__dirname, "build", "icon.ico");
const windowsSetupLoadingGifPath = path.resolve(__dirname, "build", "install-loading.gif");
type PackagerHookCallback = (error?: Error | null) => void;

export function shouldPackageRuntimeFile(file: string): boolean {
  if (!file) {
    return false;
  }

  const normalized = file.replaceAll("\\", "/").replace(/^\//, "");

  return packagedRuntimeDependencyRoots.some(
    (root) =>
      normalized === root ||
      normalized.startsWith(`${root}/`) ||
      root.startsWith(`${normalized}/`)
  );
}

export function shouldIgnorePackageFile(file: string): boolean {
  if (!file) {
    return false;
  }

  return !shouldPackageRuntimeFile(file);
}

export function resolvePackagedElectronBinary(buildPath: string, platform: string): string {
  if (platform === "darwin") {
    return path.join(buildPath, `${appBundleName}.app`, "Contents", "MacOS", executableName);
  }
  if (platform === "win32") {
    return path.join(buildPath, `${executableName}.exe`);
  }
  return path.join(buildPath, executableName);
}

function applyElectronFuses(buildPath: string, _electronVersion: string, platform: string, _arch: string, done: PackagerHookCallback): void {
  void flipFuses(resolvePackagedElectronBinary(buildPath, platform), {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: platform === "darwin",
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false
  }).then(
    () => done(),
    (error: unknown) => done(error instanceof Error ? error : new Error(String(error)))
  );
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: "**/*.node"
    },
    icon: appIconPath,
    ignore: shouldIgnorePackageFile,
    executableName,
    afterComplete: [applyElectronFuses]
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      authors: "Moshu",
      owners: "Moshu",
      loadingGif: windowsSetupLoadingGifPath,
      setupIcon: windowsSetupIconPath,
      skipUpdateIcon: true
    }),
    new MakerZIP({}, ["darwin", "win32"]),
    new MakerDMG({})
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/index.ts",
          config: "vite.main.config.ts",
          target: "main"
        },
        {
          entry: "src/preload/index.ts",
          config: "vite.preload.config.ts",
          target: "preload"
        }
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts"
        }
      ]
    })
  ]
};

export default config;
