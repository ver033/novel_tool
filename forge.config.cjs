const { MakerDMG } = require('@electron-forge/maker-dmg');
const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { MakerZIP } = require('@electron-forge/maker-zip');
const { VitePlugin } = require('@electron-forge/plugin-vite');

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'NovelTool',
    name: 'Novel Tool',
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'NovelTool',
      setupExe: 'NovelToolSetup.exe',
    }),
    new MakerZIP({}, ['win32', 'darwin']),
    new MakerDMG({}, ['darwin']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};
