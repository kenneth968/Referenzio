import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { addItems, emptyBoard } from '../../src/shared/board';
import type { BoardDocument } from '../../src/shared/contracts';

export const libraryFor = (testRoot: string) => join(testRoot, 'Referenzio', 'library');
const executablePath = resolve('out', 'Referenzio-win32-x64', 'Referenzio.exe');

function mainServices(): {
  createAssetService: (dependencies: Record<string, unknown>) => { importDroppedImages(paths: string[]): Promise<{ imported: BoardDocument['assets'] }> };
  createPersistenceService: (dependencies: { libraryRoot: string }) => {
    initialize(): Promise<void>;
    saveBoard(document: BoardDocument): Promise<{ ok: true; value: unknown } | { ok: false; error: unknown }>;
    flush(): Promise<{ ok: true; value: unknown } | { ok: false; error: unknown }>;
  };
} {
  // Playwright's TypeScript loader executes these real main-process modules. A
  // runtime require keeps tsconfig.renderer's composite program renderer-only.
  const runtimeRequire = eval('require') as NodeRequire;
  return { ...runtimeRequire('../../src/main/assets'), ...runtimeRequire('../../src/main/persistence') };
}

export async function withTestRoot<T>(work: (testRoot: string) => Promise<T>): Promise<T> {
  const testRoot = await mkdtemp(join(tmpdir(), 'referenzio-e2e-'));
  try {
    return await work(testRoot);
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
}

export async function launchReferenzio(localAppDataDir: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath,
    env: { ...process.env, LOCALAPPDATA: localAppDataDir },
  });
}

export async function closeReferenzio(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  const process = app.process();
  await app.close();
  if (process.exitCode === null) await once(process, 'exit');
}

export function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`Expected successful result: ${JSON.stringify(result.error)}`);
  return result.value;
}

export async function opaquePng(): Promise<Buffer> {
  return sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 32, g: 184, b: 216, alpha: 1 } } })
    .png()
    .toBuffer();
}

export async function writeDroppedFixture(testRoot: string, name = 'opaque.png'): Promise<string> {
  const source = join(testRoot, name);
  await writeFile(source, await opaquePng());
  return source;
}

export async function seedBoardFromDroppedFixture(testRoot: string): Promise<{
  source: string;
  library: string;
  document: BoardDocument;
}> {
  return seedBoardFromDroppedFixtures(testRoot, 1);
}

export async function seedBoardFromDroppedFixtures(testRoot: string, count: number): Promise<{
  source: string;
  library: string;
  document: BoardDocument;
}> {
  const library = libraryFor(testRoot);
  const { createAssetService, createPersistenceService } = mainServices();
  const persistence = createPersistenceService({ libraryRoot: library });
  await persistence.initialize();
  const sources = await Promise.all(Array.from({ length: count }, (_, index) => writeDroppedFixture(testRoot, `opaque-${index}.png`)));
  const assets = createAssetService({
    persistence,
    clipboard: { captureImage: async () => undefined },
  });
  const imported = await assets.importDroppedImages(sources);
  const document = addItems(emptyBoard(), imported.imported, {
    camera: { x: 0, y: 0, scale: 1 },
    viewport: { width: 1000, height: 700 },
    point: { x: 500, y: 350 },
    offsetIndex: 0,
  });
  unwrap(await persistence.saveBoard(document));
  unwrap(await persistence.flush());
  return { source: sources[0], library, document };
}

export async function seedPortraitJpegFixture(testRoot: string): Promise<{
  library: string;
  document: BoardDocument;
}> {
  const library = libraryFor(testRoot);
  const { createAssetService, createPersistenceService } = mainServices();
  const persistence = createPersistenceService({ libraryRoot: library });
  await persistence.initialize();
  const source = join(testRoot, 'portrait-oriented.jpg');
  await writeFile(source, await sharp({ create: { width: 100, height: 200, channels: 3, background: { r: 205, g: 82, b: 78 } } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer());
  const assets = createAssetService({ persistence, clipboard: { captureImage: async () => undefined } });
  const imported = await assets.importDroppedImages([source]);
  const document = addItems(emptyBoard(), imported.imported, {
    camera: { x: 0, y: 0, scale: 1 }, viewport: { width: 1000, height: 700 }, point: { x: 500, y: 350 }, offsetIndex: 0,
  });
  unwrap(await persistence.saveBoard(document));
  unwrap(await persistence.flush());
  return { library, document };
}

export async function writeBoardAndAssetFixture(testRoot: string): Promise<{
  library: string;
  document: BoardDocument;
}> {
  const seeded = await seedBoardFromDroppedFixture(testRoot);
  return { library: seeded.library, document: seeded.document };
}

export async function readPersistedBoard(testRoot: string): Promise<BoardDocument> {
  return JSON.parse(await readFile(join(libraryFor(testRoot), 'board.json'), 'utf8')) as BoardDocument;
}
