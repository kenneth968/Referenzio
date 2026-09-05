import { cp, lstat, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MAX_IMPORT_BYTES, type Result } from '../../shared/contracts';
import { createAssetService as createAssetServiceImpl, type AssetServiceDependencies } from './asset-service';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, lstat: vi.fn(original.lstat), readFile: vi.fn(original.readFile) };
});

let png = Buffer.alloc(0);
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
type MemoryPersistence = { writeAsset: ReturnType<typeof vi.fn>; assetPath(filename: string): string };
type CapturedImage = { isEmpty(): boolean; getSize(): { width: number; height: number }; toPNG(): Uint8Array };
let root = '';
let fixture = (name: string) => join(root, name);
const mockedLstat = vi.mocked(lstat);
const mockedReadFile = vi.mocked(readFile);

function createAssetService(dependencies: Omit<AssetServiceDependencies, 'persistence'> & { persistence: MemoryPersistence }) {
  return createAssetServiceImpl({ ...dependencies, persistence: dependencies.persistence as never });
}

function persistence(): MemoryPersistence {
  const assets = join(root, 'owned');
  return {
    writeAsset: vi.fn(async (filename: string, bytes: Uint8Array): Promise<Result<void>> => {
      await writeFile(join(assets, filename), bytes);
      return { ok: true, value: undefined };
    }),
    assetPath: (filename) => join(assets, filename),
  };
}

function clipboard(buffer: Buffer | undefined) {
  return { captureImage: async () => ({ isEmpty: () => buffer === undefined, getSize: () => ({ width: 1, height: 1 }), toPNG: () => buffer ?? Buffer.alloc(0) }) };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'referenzio-assets-'));
  png = await sharp({ create: { width: 1, height: 1, channels: 4, background: 'red' } }).png().toBuffer();
  await writeFile(fixture('one-pixel.png'), png);
  await writeFile(fixture('not-an-image.png'), 'not an image');
  await sharp({ create: { width: 2, height: 1, channels: 3, background: 'red' } }).jpeg().toFile(fixture('small.jpg'));
  await sharp({ create: { width: 2, height: 1, channels: 4, background: 'red' } }).webp().toFile(fixture('small.webp'));
  await sharp({ create: { width: 2, height: 3, channels: 3, background: 'red' } }).withMetadata({ orientation: 6 }).jpeg().toFile(fixture('oriented.jpg'));
  await writeFile(fixture('truncated.png'), png.subarray(0, 20));
  await mkdir(fixture('owned'));
  await mkdir(fixture('owned.png'));
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
afterEach(() => { mockedLstat.mockClear(); mockedReadFile.mockClear(); });

describe('asset service', () => {
  it('copies a verified PNG before reporting it as imported', async () => {
    const store = persistence();
    const assets = createAssetService({ persistence: store, clipboard: clipboard(undefined), now: () => new Date('2026-09-05T12:00:00.000Z'), createId: () => ids[0] });
    const result = await assets.importDroppedImages([fixture('one-pixel.png')]);
    expect(result.imported).toHaveLength(1);
    const asset = result.imported[0];
    await expect(readFile(store.assetPath(asset.filename))).resolves.toEqual(await readFile(fixture('one-pixel.png')));
    expect(asset).toMatchObject({ id: ids[0], filename: `${ids[0]}.png`, mediaType: 'image/png', pixelWidth: 1, pixelHeight: 1 });
  });

  it('allows a good file beside a rejected one', async () => {
    const assets = createAssetService({ persistence: persistence(), clipboard: clipboard(undefined), createId: () => ids[0] });
    const result = await assets.importDroppedImages([fixture('one-pixel.png'), fixture('not-an-image.png')]);
    expect(result.imported).toHaveLength(1);
    expect(result.rejected).toEqual([{ sourceName: 'not-an-image.png', code: 'DECODE_FAILED', message: 'The file is not a valid PNG image.' }]);
  });

  it('imports verified JPEG and WebP without changing their original bytes', async () => {
    let next = 0;
    const store = persistence();
    const assets = createAssetService({ persistence: store, clipboard: clipboard(undefined), createId: () => ids[next++] });
    const result = await assets.importDroppedImages([fixture('small.jpg'), fixture('small.webp')]);
    expect(result.imported.map(({ mediaType, filename }) => [mediaType, filename])).toEqual([['image/jpeg', `${ids[0]}.jpg`], ['image/webp', `${ids[1]}.webp`]]);
    await expect(readFile(store.assetPath(`${ids[0]}.jpg`))).resolves.toEqual(await readFile(fixture('small.jpg')));
  });

  it('uses EXIF orientation to expose browser-displayed JPEG dimensions', async () => {
    const assets = createAssetService({ persistence: persistence(), clipboard: clipboard(undefined), createId: () => ids[0] });
    await expect(assets.importDroppedImages([fixture('oriented.jpg')])).resolves.toMatchObject({
      imported: [{ pixelWidth: 3, pixelHeight: 2 }], rejected: [],
    });
  });

  it('rejects an empty clipboard', async () => {
    const assets = createAssetService({ persistence: persistence(), clipboard: clipboard(undefined), createId: () => ids[0] });
    await expect(assets.pasteClipboardImage()).resolves.toEqual({ ok: false, error: { code: 'CLIPBOARD_EMPTY', message: 'Copy an image, then paste it onto the canvas.', action: 'dismiss' } });
  });

  it('durably imports the clipboard PNG', async () => {
    const store = persistence();
    const assets = createAssetService({ persistence: store, clipboard: clipboard(png), createId: () => ids[0] });
    const result = await assets.pasteClipboardImage();
    expect(result).toMatchObject({ ok: true, value: { filename: `${ids[0]}.png`, mediaType: 'image/png', pixelWidth: 1, pixelHeight: 1 } });
    await expect(readFile(store.assetPath(`${ids[0]}.png`))).resolves.toEqual(png);
  });

  it('awaits asynchronous clipboard capture before ingesting its image', async () => {
    const store = persistence();
    let release!: (value: CapturedImage) => void;
    const nativeClipboard = { captureImage: vi.fn(() => new Promise<CapturedImage>((resolve) => { release = resolve; })) };
    const image: CapturedImage = { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toPNG: () => png };
    const assets = createAssetService({ persistence: store, clipboard: nativeClipboard, createId: () => ids[0] });

    const paste = assets.pasteClipboardImage();
    expect(store.writeAsset).not.toHaveBeenCalled();
    release(image);
    await expect(paste).resolves.toMatchObject({ ok: true, value: { filename: `${ids[0]}.png` } });
    expect(nativeClipboard.captureImage).toHaveBeenCalledOnce();
  });

  it('does not write corrupt image payloads', async () => {
    const store = persistence();
    const assets = createAssetService({ persistence: store, clipboard: clipboard(undefined), createId: () => ids[0] });
    const result = await assets.importDroppedImages([fixture('truncated.png')]);
    expect(result.rejected).toEqual([{ sourceName: 'truncated.png', code: 'DECODE_FAILED', message: 'The file is not a valid PNG image.' }]);
    expect(store.writeAsset).not.toHaveBeenCalled();
  });

  it('rejects a claimed extension that differs from the decoded image', async () => {
    await cp(fixture('one-pixel.png'), fixture('actually-png.jpg'));
    const assets = createAssetService({ persistence: persistence(), clipboard: clipboard(undefined), createId: () => ids[0] });
    await expect(assets.importDroppedImages([fixture('actually-png.jpg')])).resolves.toMatchObject({ rejected: [{ code: 'TYPE_MISMATCH' }] });
  });

  it('rejects a destination write failure without returning an asset', async () => {
    const store = persistence();
    store.writeAsset.mockResolvedValueOnce({ ok: false, error: { code: 'ASSET_SAVE_FAILED', message: 'nope', action: 'retry-save' } });
    const assets = createAssetService({ persistence: store, clipboard: clipboard(png), createId: () => ids[0] });
    await expect(assets.pasteClipboardImage()).resolves.toMatchObject({ ok: false, error: { code: 'ASSET_WRITE_FAILED' } });
  });

  it('keeps imported bytes readable after the source file is deleted', async () => {
    const store = persistence();
    const source = fixture('remove-after-import.png');
    await cp(fixture('one-pixel.png'), source);
    const assets = createAssetService({ persistence: store, clipboard: clipboard(undefined), createId: () => ids[0] });
    const result = await assets.importDroppedImages([source]);
    await rm(source);
    await expect(readFile(store.assetPath(result.imported[0].filename))).resolves.toEqual(png);
  });

  it('reads a regular file at the exact 100 MiB boundary', async () => {
    const source = 'C:\\virtual\\exact-limit.png';
    mockedLstat.mockResolvedValueOnce({ isFile: () => true, size: MAX_IMPORT_BYTES } as never);
    mockedReadFile.mockResolvedValueOnce(png as never);
    const assets = createAssetService({ persistence: persistence(), clipboard: clipboard(undefined), createId: () => ids[0] });
    await expect(assets.importDroppedImages([source])).resolves.toMatchObject({ imported: [expect.any(Object)], rejected: [] });
    expect(mockedReadFile).toHaveBeenCalledWith(source);
  });

  it('rejects a regular file above the 100 MiB boundary before reading it', async () => {
    const source = 'C:\\virtual\\over-limit.png';
    mockedLstat.mockResolvedValueOnce({ isFile: () => true, size: MAX_IMPORT_BYTES + 1 } as never);
    const assets = createAssetService({ persistence: persistence(), clipboard: clipboard(undefined), createId: () => ids[0] });
    await expect(assets.importDroppedImages([source])).resolves.toEqual({
      imported: [], rejected: [{ sourceName: 'over-limit.png', code: 'FILE_TOO_LARGE', message: 'The file is larger than the 100 MiB import limit.' }],
    });
    expect(mockedReadFile).not.toHaveBeenCalled();
  });

  it('imports a PNG at the exact 40,000,000-pixel decoded boundary', async () => {
    const source = fixture('pixel-limit.png');
    await sharp({ create: { width: 8_000, height: 5_000, channels: 4, background: 'red' } }).png().toFile(source);
    const assets = createAssetService({ persistence: persistence(), clipboard: clipboard(undefined), createId: () => ids[0] });
    await expect(assets.importDroppedImages([source])).resolves.toMatchObject({
      imported: [{ pixelWidth: 8_000, pixelHeight: 5_000 }], rejected: [],
    });
  });

  it('rejects a PNG one row beyond the decoded pixel limit', async () => {
    const source = fixture('pixel-limit-plus-one.png');
    await sharp({ create: { width: 8_000, height: 5_001, channels: 4, background: 'red' } }).png().toFile(source);
    const assets = createAssetService({ persistence: persistence(), clipboard: clipboard(undefined), createId: () => ids[0] });
    await expect(assets.importDroppedImages([source])).resolves.toMatchObject({
      imported: [], rejected: [{ code: 'IMAGE_TOO_LARGE' }],
    });
  });

  it('rejects a symlinked input through lstat before extension classification', async () => {
    const source = 'C:\\virtual\\symlink-without-extension';
    mockedLstat.mockResolvedValueOnce({ isFile: () => false, size: 0 } as never);
    const assets = createAssetService({ persistence: persistence(), clipboard: clipboard(undefined), createId: () => ids[0] });
    await expect(assets.importDroppedImages([source])).resolves.toEqual({
      imported: [], rejected: [{ sourceName: 'symlink-without-extension', code: 'FILE_UNREADABLE', message: 'The file could not be read.' }],
    });
    expect(mockedReadFile).not.toHaveBeenCalled();
  });

  it('rejects directories without attempting an image write', async () => {
    const store = persistence();
    const assets = createAssetService({ persistence: store, clipboard: clipboard(undefined), createId: () => ids[0] });
    await expect(assets.importDroppedImages([fixture('owned.png')])).resolves.toEqual({
      imported: [], rejected: [{ sourceName: 'owned.png', code: 'FILE_UNREADABLE', message: 'The file could not be read.' }],
    });
    expect(store.writeAsset).not.toHaveBeenCalled();
  });

  it('serializes overlapping imports so only one durable write is active', async () => {
    const store = persistence();
    let releaseFirst: (() => void) | undefined;
    store.writeAsset.mockImplementationOnce(() => new Promise<Result<void>>((resolve) => { releaseFirst = () => resolve({ ok: true, value: undefined }); }));
    const assets = createAssetService({ persistence: store, clipboard: clipboard(undefined), createId: () => ids[0] });
    const first = assets.importDroppedImages([fixture('one-pixel.png')]);
    const second = assets.importDroppedImages([fixture('one-pixel.png')]);
    await vi.waitFor(() => expect(store.writeAsset).toHaveBeenCalledTimes(1));
    expect(releaseFirst).toBeTypeOf('function');
    releaseFirst?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ imported: [expect.objectContaining({ filename: `${ids[0]}.png` })] }),
      expect.objectContaining({ imported: [expect.objectContaining({ filename: `${ids[0]}.png` })] }),
    ]);
  });

  it('captures a clipboard bitmap before waiting for an occupied import queue', async () => {
    const store = persistence();
    let releaseFirst: (() => void) | undefined;
    store.writeAsset.mockImplementationOnce(() => new Promise<Result<void>>((resolve) => { releaseFirst = () => resolve({ ok: true, value: undefined }); }));
    let captured = png;
    const nativeClipboard = { captureImage: async () => {
      const snapshot = captured;
      return { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toPNG: () => snapshot };
    } };
    let next = 0;
    const assets = createAssetService({ persistence: store, clipboard: nativeClipboard, createId: () => ids[next++] });
    const heldImport = assets.importDroppedImages([fixture('one-pixel.png')]);
    await vi.waitFor(() => expect(store.writeAsset).toHaveBeenCalledTimes(1));
    const paste = assets.pasteClipboardImage();
    captured = await sharp({ create: { width: 1, height: 1, channels: 4, background: 'blue' } }).png().toBuffer();
    releaseFirst?.();
    await heldImport;
    const result = await paste;
    if (!result.ok) throw new Error('clipboard paste should succeed');
    await expect(readFile(store.assetPath(result.value.filename))).resolves.toEqual(png);
  });
});
