import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyBoard } from '../../shared/board';

const atomicFault = vi.hoisted(() => ({
  failPrimaryRepair: false,
  delayFirstSettingsWrite: false,
  firstSettingsWriteStarted: undefined as (() => void) | undefined,
  releaseFirstSettingsWrite: undefined as (() => void) | undefined,
}));

vi.mock('./atomic-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./atomic-file')>();
  return {
    ...actual,
    writeDurableJson: async (path: string, text: string) => {
      if (atomicFault.failPrimaryRepair && path.endsWith('board.json')) throw new Error('simulated primary repair failure');
      if (atomicFault.delayFirstSettingsWrite && path.endsWith('settings.json')) {
        atomicFault.delayFirstSettingsWrite = false;
        atomicFault.firstSettingsWriteStarted?.();
        await new Promise<void>((resolve) => { atomicFault.releaseFirstSettingsWrite = resolve; });
      }
      return actual.writeDurableJson(path, text);
    },
  };
});

import { createPersistenceService } from './index';

const now = () => new Date('2026-09-04T12:00:00.000Z');
const roots: string[] = [];
const assetId = '11111111-1111-4111-8111-111111111111';

async function createService() {
  const root = await mkdtemp(join(tmpdir(), 'referenzio-persistence-'));
  roots.push(root);
  const service = createPersistenceService({ libraryRoot: root, now });
  await service.initialize();
  return { root, service };
}

function validBoard({ revision = 0, withAsset = false }: { revision?: number; withAsset?: boolean } = {}) {
  if (!withAsset) return { ...emptyBoard(), revision };
  const asset = {
    id: assetId, filename: `${assetId}.png`, mediaType: 'image/png' as const,
    pixelWidth: 10, pixelHeight: 10, byteSize: 1, importedAt: '2026-01-01T00:00:00.000Z',
  };
  return { ...emptyBoard(), revision, assets: [asset] };
}

afterEach(async () => {
  atomicFault.failPrimaryRepair = false;
  atomicFault.delayFirstSettingsWrite = false;
  atomicFault.firstSettingsWriteStarted = undefined;
  atomicFault.releaseFirstSettingsWrite = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('persistence service', () => {
  it('recovers a valid backup and preserves an invalid primary for inspection', async () => {
    const { root, service } = await createService();
    await writeFile(join(root, 'board.json'), '{not-json');
    await writeFile(join(root, 'board.backup.json'), JSON.stringify(validBoard({ revision: 7 })));

    const result = await service.loadBoard();
    expect(result.recovery).toBe('backup');
    expect(result.document.revision).toBe(7);
    await expect(readdir(root)).resolves.toContain('board.invalid-2026-09-04T12-00-00.000Z.json');
  });

  it('preserves both damaged snapshots when the injected recovery timestamp already exists', async () => {
    const { root, service } = await createService();
    const collision = 'board.invalid-2026-09-04T12-00-00.000Z.json';
    await writeFile(join(root, collision), '{older damaged snapshot}');
    await writeFile(join(root, 'board.json'), '{newer damaged snapshot}');
    await writeFile(join(root, 'board.backup.json'), JSON.stringify(validBoard({ revision: 7 })));

    expect((await service.loadBoard()).recovery).toBe('backup');
    expect(await readFile(join(root, collision), 'utf8')).toBe('{older damaged snapshot}');
    expect(await readFile(join(root, 'board.invalid-2026-09-04T12-00-00.000Z-1.json'), 'utf8')).toBe('{newer damaged snapshot}');
  });

  it('retains recovered work on a second launch without intervening edits', async () => {
    const { root, service } = await createService();
    const recovered = validBoard({ revision: 7 });
    await writeFile(join(root, 'board.json'), '{broken');
    await writeFile(join(root, 'board.backup.json'), JSON.stringify(recovered));
    expect((await service.loadBoard()).document).toEqual(recovered);

    const restarted = createPersistenceService({ libraryRoot: root, now });
    await restarted.initialize();
    expect((await restarted.loadBoard()).document).toEqual(recovered);
    expect(JSON.parse(await readFile(join(root, 'board.backup.json'), 'utf8'))).toEqual(recovered);
  });

  it('treats a missing primary and valid backup as recovery', async () => {
    const { root, service } = await createService();
    await writeFile(join(root, 'board.backup.json'), JSON.stringify(validBoard({ revision: 4 })));
    const result = await service.loadBoard();
    expect(result).toMatchObject({ recovery: 'backup', document: { revision: 4 } });
    expect(JSON.parse(await readFile(join(root, 'board.json'), 'utf8'))).toMatchObject({ revision: 4 });
  });

  it('retries the same revision after backup repair initially fails', async () => {
    const { root, service } = await createService();
    const recovered = validBoard({ revision: 7 });
    await writeFile(join(root, 'board.json'), '{broken');
    await writeFile(join(root, 'board.backup.json'), JSON.stringify(recovered));
    atomicFault.failPrimaryRepair = true;

    expect(await service.loadBoard()).toMatchObject({ recovery: 'backup', document: { revision: 7 } });
    expect(await service.flush()).toMatchObject({ ok: false, error: { code: 'BOARD_SAVE_FAILED' } });

    atomicFault.failPrimaryRepair = false;
    expect(await service.saveBoard(recovered)).toMatchObject({ ok: true, value: { revision: 7 } });
    expect(await service.flush()).toMatchObject({ ok: true });
    expect(JSON.parse(await readFile(join(root, 'board.json'), 'utf8'))).toEqual(recovered);
  });

  it('propagates primary read I/O failures without creating an empty board', async () => {
    const { root, service } = await createService();
    await mkdir(join(root, 'board.json'));

    await expect(service.loadBoard()).rejects.toMatchObject({ code: 'EISDIR' });
    expect((await readdir(root)).includes('board.json')).toBe(true);
    expect((await readdir(root)).some((entry) => entry.startsWith('board.invalid-'))).toBe(false);
  });

  it('selects primary, backup, or an empty board correctly', async () => {
    const first = await createService();
    expect((await first.service.loadBoard()).recovery).toBe('empty');
    await writeFile(join(first.root, 'board.json'), JSON.stringify(validBoard({ revision: 2 })));
    expect((await first.service.loadBoard()).recovery).toBe('primary');
    await rm(join(first.root, 'board.json'));
    await writeFile(join(first.root, 'board.backup.json'), JSON.stringify(validBoard({ revision: 1 })));
    expect((await first.service.loadBoard()).recovery).toBe('backup');
  });

  it('never allows a stale queued snapshot to replace a newer revision', async () => {
    const { root, service } = await createService();
    await Promise.all([service.saveBoard(validBoard({ revision: 2 })), service.saveBoard(validBoard({ revision: 3 }))]);
    expect(JSON.parse(await readFile(join(root, 'board.json'), 'utf8')).revision).toBe(3);
  });

  it('keeps the previous valid document as backup after a later save', async () => {
    const { root, service } = await createService();
    await service.saveBoard(validBoard({ revision: 1 }));
    await service.saveBoard(validBoard({ revision: 2 }));
    expect(JSON.parse(await readFile(join(root, 'board.json'), 'utf8')).revision).toBe(2);
    expect(JSON.parse(await readFile(join(root, 'board.backup.json'), 'utf8')).revision).toBe(1);
  });

  it('archives an invalid backup before rotating two later primary snapshots', async () => {
    const { root, service } = await createService();
    await writeFile(join(root, 'board.json'), JSON.stringify(validBoard({ revision: 1 })));
    await writeFile(join(root, 'board.backup.json'), '{damaged backup bytes}');
    await service.loadBoard();

    await expect(service.saveBoard(validBoard({ revision: 2 }))).resolves.toMatchObject({ ok: true });
    await expect(service.saveBoard(validBoard({ revision: 3 }))).resolves.toMatchObject({ ok: true });

    expect(await readFile(join(root, 'board.backup.invalid-2026-09-04T12-00-00.000Z.json'), 'utf8')).toBe('{damaged backup bytes}');
    expect(JSON.parse(await readFile(join(root, 'board.backup.json'), 'utf8')).revision).toBe(2);
    expect(JSON.parse(await readFile(join(root, 'board.json'), 'utf8')).revision).toBe(3);
  });

  it('rejects malformed boards without replacing the primary snapshot', async () => {
    const { root, service } = await createService();
    await service.saveBoard(validBoard({ revision: 1 }));
    const result = await service.saveBoard({ ...validBoard({ revision: 2 }), schemaVersion: 99 } as never);
    expect(result).toMatchObject({ ok: false, error: { code: 'BOARD_INVALID' } });
    expect(JSON.parse(await readFile(join(root, 'board.json'), 'utf8')).revision).toBe(1);
  });

  it('reports missing assets but accepts a durable asset write', async () => {
    const { service } = await createService();
    const board = validBoard({ revision: 1, withAsset: true });
    expect((await service.loadBoard()).missingAssetIds).toEqual([]);
    await service.saveBoard(board);
    expect((await service.loadBoard()).missingAssetIds).toEqual([assetId]);
    await expect(service.writeAsset(`${assetId}.png`, new Uint8Array([1]))).resolves.toMatchObject({ ok: true });
    expect((await service.loadBoard()).missingAssetIds).toEqual([]);
    expect(await service.writeAsset('../escape.png', new Uint8Array([1]))).toMatchObject({ ok: false, error: { code: 'ASSET_INVALID' } });
    expect(() => service.assetPath('../escape.png')).toThrow('Asset filename');
  });

  it('loads defaults and saves valid settings', async () => {
    const { root, service } = await createService();
    expect(await service.loadSettings()).toEqual({ bounds: { x: 100, y: 100, width: 1200, height: 800 }, alwaysOnTop: false });
    await writeFile(join(root, 'settings.json'), '{broken');
    expect(await service.loadSettings()).toEqual({ bounds: { x: 100, y: 100, width: 1200, height: 800 }, alwaysOnTop: false });
    await expect(service.saveSettings({ bounds: { x: 1, y: 2, width: 3, height: 4 }, alwaysOnTop: true })).resolves.toMatchObject({ ok: true });
    expect(await service.loadSettings()).toEqual({ bounds: { x: 1, y: 2, width: 3, height: 4 }, alwaysOnTop: true });
  });

  it('returns Result failures when initialization cannot create a library directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'referenzio-persistence-'));
    roots.push(root);
    const libraryFile = join(root, 'library-file');
    await writeFile(libraryFile, 'not a directory');
    const service = createPersistenceService({ libraryRoot: libraryFile, now });

    await expect(service.saveSettings({ bounds: { x: 1, y: 2, width: 3, height: 4 }, alwaysOnTop: true }))
      .resolves.toMatchObject({ ok: false, error: { code: 'SETTINGS_SAVE_FAILED' } });
    await expect(service.writeAsset(`${assetId}.png`, new Uint8Array([1])))
      .resolves.toMatchObject({ ok: false, error: { code: 'ASSET_SAVE_FAILED' } });
  });

  it('retries initialization after a transient filesystem failure is repaired', async () => {
    const root = await mkdtemp(join(tmpdir(), 'referenzio-persistence-'));
    roots.push(root);
    const libraryFile = join(root, 'library-file');
    await writeFile(libraryFile, 'not a directory');
    const service = createPersistenceService({ libraryRoot: libraryFile, now });
    expect(await service.saveSettings({ bounds: { x: 1, y: 2, width: 3, height: 4 }, alwaysOnTop: true }))
      .toMatchObject({ ok: false, error: { code: 'SETTINGS_SAVE_FAILED' } });

    await rm(libraryFile);
    expect(await service.saveSettings({ bounds: { x: 5, y: 6, width: 7, height: 8 }, alwaysOnTop: false }))
      .toMatchObject({ ok: true });
    expect(await service.loadSettings()).toEqual({ bounds: { x: 5, y: 6, width: 7, height: 8 }, alwaysOnTop: false });
  });

  it('serializes overlapping settings saves so the latest bounds win', async () => {
    const { service } = await createService();
    let firstWriteStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstWriteStarted = resolve; });
    atomicFault.firstSettingsWriteStarted = firstWriteStarted;
    atomicFault.delayFirstSettingsWrite = true;

    const older = service.saveSettings({ bounds: { x: 1, y: 2, width: 3, height: 4 }, alwaysOnTop: false });
    await started;
    const newer = service.saveSettings({ bounds: { x: 5, y: 6, width: 7, height: 8 }, alwaysOnTop: true });
    atomicFault.releaseFirstSettingsWrite?.();
    await Promise.all([older, newer]);

    expect(await service.loadSettings()).toEqual({ bounds: { x: 5, y: 6, width: 7, height: 8 }, alwaysOnTop: true });
  });

  it('flushes the final queued revision', async () => {
    const { root, service } = await createService();
    const pending = Promise.all([service.saveBoard(validBoard({ revision: 1 })), service.saveBoard(validBoard({ revision: 2 }))]);
    await expect(service.flush()).resolves.toMatchObject({ ok: true });
    await pending;
    expect(JSON.parse(await readFile(join(root, 'board.json'), 'utf8')).revision).toBe(2);
  });

  it('leaves no same-directory temporary file after a failed commit', async () => {
    const { root, service } = await createService();
    // A directory where the primary file belongs makes the post-stage read fail.
    await mkdir(join(root, 'board.json'));
    expect(await service.saveBoard(validBoard({ revision: 1 }))).toMatchObject({ ok: false, error: { code: 'BOARD_SAVE_FAILED' } });
    expect((await readdir(root)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('does not let a late lower revision replace a failed newer revision', async () => {
    const { root, service } = await createService();
    await service.saveBoard(validBoard({ revision: 1 }));
    // Backup replacement fails, so revision 3 remains uncommitted and revision 2 is stale.
    await mkdir(join(root, 'board.backup.json'));
    expect(await service.saveBoard(validBoard({ revision: 3 }))).toMatchObject({ ok: false, error: { code: 'BOARD_SAVE_FAILED' } });
    expect(await service.saveBoard(validBoard({ revision: 2 }))).toMatchObject({ ok: true, value: { revision: 1 } });
    expect(JSON.parse(await readFile(join(root, 'board.json'), 'utf8')).revision).toBe(1);
    expect(await service.flush()).toMatchObject({ ok: false, error: { code: 'BOARD_SAVE_FAILED' } });
  });
});
