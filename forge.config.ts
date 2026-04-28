import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";

const packagedRuntimeDependencyRoots = [
  ".vite",
  "package.json",
  "node_modules/better-sqlite3",
  "node_modules/bindings",
  "node_modules/file-uri-to-path"
];

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

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: "**/*.node"
    },
    ignore: shouldIgnorePackageFile
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ["darwin"]),
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
