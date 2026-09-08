import type { ForgeConfig } from '@electron-forge/shared-types';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const lock = JSON.parse(readFileSync(path.resolve('package-lock.json'), 'utf8')) as {
  packages: Record<string, { dev?: boolean }>;
};
const runtimeDirectories = Object.entries(lock.packages)
  .filter(([directory, metadata]) => directory.startsWith('node_modules/') && !metadata.dev)
  .map(([directory]) => `/${directory}`);

const config: ForgeConfig = {
  packagerConfig: {
    // Vite externalizes Sharp. Copy the locked runtime tree, including optional binaries.
    // Filter dev packages here rather than traversing Forge's unused template dependencies.
    prune: false,
    ignore: (file) => file !== '' && file !== '/package.json' && !/^\/\.vite(?:\/|$)/.test(file)
      && !runtimeDirectories.some((directory) => file === directory || file.startsWith(`${directory}/`) || directory.startsWith(`${file}/`)),
    // Native Sharp binaries and their DLLs must be real files beside one another.
    asar: { unpack: '**/node_modules/@img/**/*' },
  },
  makers: [new MakerSquirrel({ name: 'referenzio' }), new MakerZIP({}, ['win32'])],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.ts' },
        { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
    new AutoUnpackNativesPlugin({}),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: process.env.REFERENZIO_E2E_BUILD === '1',
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
