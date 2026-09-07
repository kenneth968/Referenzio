import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../forge.config';

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe('application scaffold', () => {
  it('keeps external runtime dependencies and their native libraries in the package', () => {
    const ignore = config.packagerConfig?.ignore;
    expect(typeof ignore).toBe('function');
    if (typeof ignore !== 'function') throw new Error('Package filter must keep runtime modules');
    for (const file of ['', '/package.json', '/.vite/build/main.js', '/node_modules', '/node_modules/sharp/lib/index.js', '/node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node']) {
      expect(ignore(file)).toBe(false);
    }
    expect(ignore('/src/main/index.ts')).toBe(true);
    expect(ignore('/node_modules/vitest/package.json')).toBe(true);
    expect(ignore('/node_modules/@electron-forge/core/package.json')).toBe(true);
    expect(ignore('/.superpowers/sdd/progress.md')).toBe(true);
    expect(config.packagerConfig?.asar).toMatchObject({ unpack: '**/node_modules/@img/**/*' });
  });
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
});
