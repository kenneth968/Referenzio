import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import forgeConfig from '../../forge.config';

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe('application scaffold', () => {
  it('pins the desktop runtime and exposes the required gates', () => {
    expect(pkg.scripts).toMatchObject({
      start: 'electron-forge start',
      typecheck: 'tsc -b',
      'test:unit': 'vitest run',
      'test:e2e': 'playwright test',
      package: 'electron-forge package',
      'package:test': 'cross-env REFERENZIO_E2E_BUILD=1 electron-forge package --arch=x64',
      make: 'electron-forge make',
    });
    expect(pkg.devDependencies.electron).toBe('44.2.0');
    expect(pkg.dependencies.react).toBe('19.2.8');
    expect(pkg.dependencies['react-konva']).toBe('19.2.5');
  });

  it('keeps locked runtime dependencies in packaged output while pruning dev dependencies', () => {
    const packagerConfig = forgeConfig.packagerConfig as {
      prune?: boolean;
      ignore?: (file: string) => boolean;
      asar?: { unpack?: string };
    };

    expect(packagerConfig.prune).toBe(false);
    expect(packagerConfig.ignore?.('/node_modules/sharp')).toBe(false);
    expect(packagerConfig.ignore?.('/node_modules/vitest')).toBe(true);
    expect(packagerConfig.asar).toEqual({ unpack: '**/node_modules/@img/**/*' });
  });
});
