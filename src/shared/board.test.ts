import { describe, expect, it } from 'vitest';
import {
  addItems, deleteItem, emptyBoard, fitBoardCamera, fitInitialImageSize, moveItem,
  reorderItem, resizeItem, worldPointForScreenPoint, zoomAtPoint,
} from './board';
import { BoardDocumentSchema, DropRequestSchema, MAX_SCALE, MIN_SCALE, PasteRequestSchema } from './contracts';

const asset = {
  id: '11111111-1111-4111-8111-111111111111', filename: '11111111-1111-4111-8111-111111111111.png',
  mediaType: 'image/png' as const, pixelWidth: 400, pixelHeight: 200, byteSize: 10,
  importedAt: '2026-01-01T00:00:00.000Z',
};
const item = {
  id: '22222222-2222-4222-8222-222222222222', assetId: asset.id, x: 10, y: 20,
  width: 100, height: 50, zIndex: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const board = () => ({ ...emptyBoard(), assets: [asset], items: [item] });

describe('board commands', () => {
  it('keeps the world coordinate under the pointer while zooming', () => {
    expect(zoomAtPoint({ x: 10, y: 20, scale: 1 }, { x: 110, y: 220 }, 2))
      .toEqual({ x: -90, y: -180, scale: 2 });
  });

  it('renormalizes z-index when moving an item to the front', () => {
    const doc = emptyBoard();
    const seeded = { ...doc, items: [
      { id: 'a', assetId: 'asset-a', x: 0, y: 0, width: 100, height: 50, zIndex: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', assetId: 'asset-b', x: 0, y: 0, width: 100, height: 50, zIndex: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ] };
    expect(reorderItem(seeded, 'a', 'front').items.map(({ id, zIndex }) => [id, zIndex]))
      .toEqual([['b', 0], ['a', 1]]);
  });

  it('clamps zoom and preserves an arbitrary pointer world coordinate', () => {
    const camera = { x: 33, y: -71, scale: 1.25 };
    const pointer = { x: 847, y: 193 };
    const world = worldPointForScreenPoint(camera, pointer);
    expect(zoomAtPoint(camera, pointer, 0).scale).toBe(MIN_SCALE);
    expect(zoomAtPoint(camera, pointer, 99).scale).toBe(MAX_SCALE);
    expect(worldPointForScreenPoint(zoomAtPoint(camera, pointer, 2.75), pointer)).toEqual(world);
  });

  it('fits initial images without upscaling', () => {
    const viewport = { width: 2000, height: 2000 };
    expect(fitInitialImageSize(asset, { x: 0, y: 0, scale: 1 }, viewport)).toEqual({ width: 400, height: 200 });
    expect(fitInitialImageSize({ ...asset, pixelWidth: 4000, pixelHeight: 1000 }, { x: 0, y: 0, scale: 1 }, { width: 1000, height: 1000 }))
      .toEqual({ width: 640, height: 160 });
    expect(fitInitialImageSize({ ...asset, pixelWidth: 1000, pixelHeight: 4000 }, { x: 0, y: 0, scale: 1 }, { width: 1000, height: 1000 }))
      .toEqual({ width: 120, height: 480 });
  });

  it('fits the union of all placements without changing their geometry', () => {
    const items = [{ ...item, x: -100, y: -50, width: 200, height: 100 }];
    expect(fitBoardCamera(items, { width: 448, height: 248 })).toEqual({ x: 224, y: 124, scale: 2 });
    expect(items[0]).toMatchObject({ x: -100, y: -50, width: 200, height: 100 });
    expect(fitBoardCamera([], { width: 100, height: 100 })).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('places imports around their captured world point with a zoom-independent stagger', () => {
    const second = { ...asset, id: '33333333-3333-4333-8333-333333333333', filename: '33333333-3333-4333-8333-333333333333.png' };
    const result = addItems(emptyBoard(), [asset, second], {
      point: { x: 500, y: 200 }, camera: { x: 0, y: 0, scale: 2 }, viewport: { width: 1000, height: 700 }, offsetIndex: 0,
    });
    expect(result.revision).toBe(1);
    expect(result.items.map(({ x, y, zIndex }) => ({ x, y, zIndex }))).toEqual([
      { x: 340, y: 120, zIndex: 0 }, { x: 352, y: 132, zIndex: 1 },
    ]);
  });

  it('moves, resizes, deletes, and does not revise no-ops', () => {
    const original = board();
    expect(moveItem(original, item.id, { x: 10, y: 20 })).toBe(original);
    const moved = moveItem(original, item.id, { x: 30, y: 40 });
    expect(moved.revision).toBe(1);
    const resized = resizeItem(moved, item.id, { x: 5, y: 6, width: 50 });
    expect(resized.revision).toBe(2);
    expect(resized.items[0]).toMatchObject({ x: 5, y: 6, width: 50, height: 25 });
    expect(resizeItem(resized, item.id, { x: 5, y: 6, width: 50 })).toBe(resized);
    expect(resizeItem(original, item.id, { x: 0, y: 0, width: 1 }).items[0]).toMatchObject({ width: 24, height: 12 });
    const deleted = deleteItem(resized, item.id);
    expect(deleted).toMatchObject({ revision: 3, assets: [asset], items: [] });
  });

  it('throws on unknown command IDs', () => {
    expect(() => moveItem(board(), 'missing', { x: 0, y: 0 })).toThrow('Unknown board item');
    expect(() => deleteItem(board(), 'missing')).toThrow('Unknown board item');
  });
});

describe('contract schemas', () => {
  it('rejects incompatible board documents', () => {
    const valid = board();
    expect(BoardDocumentSchema.safeParse({ ...valid, schemaVersion: 2 }).success).toBe(false);
    expect(BoardDocumentSchema.safeParse({ ...valid, assets: [asset, asset] }).success).toBe(false);
    expect(BoardDocumentSchema.safeParse({ ...valid, items: [{ ...item, zIndex: 2 }] }).success).toBe(false);
    expect(BoardDocumentSchema.safeParse({ ...valid, items: [{ ...item, assetId: '44444444-4444-4444-8444-444444444444' }] }).success).toBe(false);
  });

  it('only accepts bounded Windows drive-letter drop paths', () => {
    expect(DropRequestSchema.safeParse(['C:\\images\\one.png']).success).toBe(true);
    expect(DropRequestSchema.safeParse(['\\\\server\\share\\one.png']).success).toBe(false);
    expect(DropRequestSchema.safeParse(['\\\\?\\C:\\images\\one.png']).success).toBe(false);
    expect(DropRequestSchema.safeParse(['images\\one.png']).success).toBe(false);
    expect(DropRequestSchema.safeParse(Array.from({ length: 33 }, (_, index) => `C:\\${index}.png`)).success).toBe(false);
  });

  it('accepts the payload-less clipboard paste invocation', () => {
    expect(PasteRequestSchema.safeParse(undefined).success).toBe(true);
  });
});
