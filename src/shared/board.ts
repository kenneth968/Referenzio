import {
  BOARD_SCHEMA_VERSION, BoardDocumentSchema, MAX_SCALE, MIN_SCALE,
  type Asset, type BoardDocument, type BoardItem, type Camera, type Placement, type Point, type Viewport,
} from './contracts';

const MIN_ITEM_WIDTH = 24;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const changed = (document: BoardDocument, items: BoardItem[]) => ({ ...document, revision: document.revision + 1, items });
const now = () => new Date().toISOString();

export function emptyBoard(): BoardDocument {
  return { schemaVersion: BOARD_SCHEMA_VERSION, revision: 0, camera: { x: 0, y: 0, scale: 1 }, assets: [], items: [] };
}

export function assertBoardDocument(value: unknown): BoardDocument {
  return BoardDocumentSchema.parse(value);
}

export function worldPointForScreenPoint(camera: Camera, point: Point): Point {
  return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale };
}

export function zoomAtPoint(camera: Camera, pointer: Point, nextScale: number): Camera {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  if (scale === camera.scale) return camera;
  const world = worldPointForScreenPoint(camera, pointer);
  return { x: pointer.x - world.x * scale, y: pointer.y - world.y * scale, scale };
}

export function fitInitialImageSize(asset: Asset, camera: Camera, viewport: Viewport): { width: number; height: number } {
  const maxScreenWidth = Math.min(640, Math.max(1, viewport.width - 48));
  const maxScreenHeight = Math.min(480, Math.max(1, viewport.height - 48));
  const factor = Math.min(1, maxScreenWidth / (asset.pixelWidth * camera.scale), maxScreenHeight / (asset.pixelHeight * camera.scale));
  return { width: asset.pixelWidth * factor, height: asset.pixelHeight * factor };
}

export function fitBoardCamera(items: BoardItem[], viewport: Viewport): Camera {
  if (!items.length) return { x: 0, y: 0, scale: 1 };
  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.y));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  const width = right - left;
  const height = bottom - top;
  const availableWidth = Math.max(1, viewport.width - 48);
  const availableHeight = Math.max(1, viewport.height - 48);
  const scale = clamp(Math.min(availableWidth / width, availableHeight / height), MIN_SCALE, MAX_SCALE);
  return { x: viewport.width / 2 - ((left + right) / 2) * scale, y: viewport.height / 2 - ((top + bottom) / 2) * scale, scale };
}

export function addItems(document: BoardDocument, assets: Asset[], placement: Placement): BoardDocument {
  if (!assets.length) return document;
  const timestamp = now();
  const items = assets.map((asset, index) => {
    const size = fitInitialImageSize(asset, placement.camera, placement.viewport);
    const offset = (placement.offsetIndex + index) * 24 / placement.camera.scale;
    return {
      id: crypto.randomUUID(), assetId: asset.id,
      x: placement.point.x - size.width / 2 + offset,
      y: placement.point.y - size.height / 2 + offset,
      width: size.width, height: size.height, zIndex: document.items.length + index,
      createdAt: timestamp, updatedAt: timestamp,
    };
  });
  return { ...document, revision: document.revision + 1, assets: [...document.assets, ...assets], items: [...document.items, ...items] };
}

function itemAt(document: BoardDocument, itemId: string): [number, BoardItem] {
  const index = document.items.findIndex((item) => item.id === itemId);
  if (index < 0) throw new Error(`Unknown board item: ${itemId}`);
  return [index, document.items[index]];
}

export function moveItem(document: BoardDocument, itemId: string, point: Point): BoardDocument {
  const [index, item] = itemAt(document, itemId);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Item coordinates must be finite');
  if (item.x === point.x && item.y === point.y) return document;
  const items = [...document.items];
  items[index] = { ...item, x: point.x, y: point.y, updatedAt: now() };
  return changed(document, items);
}

export function resizeItem(document: BoardDocument, itemId: string, transform: { x: number; y: number; width: number }): BoardDocument {
  const [index, item] = itemAt(document, itemId);
  if (!Number.isFinite(transform.x) || !Number.isFinite(transform.y) || !Number.isFinite(transform.width)) throw new Error('Resize values must be finite');
  const asset = document.assets.find((candidate) => candidate.id === item.assetId);
  if (!asset) throw new Error(`Unknown asset for board item: ${item.assetId}`);
  const width = Math.max(MIN_ITEM_WIDTH, transform.width);
  const height = width * asset.pixelHeight / asset.pixelWidth;
  if (item.x === transform.x && item.y === transform.y && item.width === width && item.height === height) return document;
  const items = [...document.items];
  items[index] = { ...item, x: transform.x, y: transform.y, width, height, updatedAt: now() };
  return changed(document, items);
}

export function deleteItem(document: BoardDocument, itemId: string): BoardDocument {
  const [index] = itemAt(document, itemId);
  return changed(document, document.items.filter((_, itemIndex) => itemIndex !== index).map((item, zIndex) => ({ ...item, zIndex })));
}

export function reorderItem(document: BoardDocument, itemId: string, direction: 'front' | 'back' | 'forward' | 'backward'): BoardDocument {
  const [index, item] = itemAt(document, itemId);
  const target = direction === 'front' ? document.items.length - 1 : direction === 'back' ? 0 : direction === 'forward' ? index + 1 : index - 1;
  if (target < 0 || target >= document.items.length || target === index) return document;
  const reordered = [...document.items];
  reordered.splice(index, 1);
  reordered.splice(target, 0, item);
  const timestamp = now();
  return changed(document, reordered.map((candidate, zIndex) => ({ ...candidate, zIndex, ...(candidate.id === itemId ? { updatedAt: timestamp } : {}) })));
}
