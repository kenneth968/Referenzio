import { z } from 'zod';

export const BOARD_SCHEMA_VERSION = 1 as const;
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;
export const MAX_IMPORT_BYTES = 104_857_600;
export const MAX_IMPORT_PIXELS = 40_000_000;

const CanonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  'expected a canonical UUID',
);
const IsoTimestampSchema = z.string().datetime({ offset: true });
const FiniteNumberSchema = z.number().finite();
const PositiveIntegerSchema = z.number().int().positive();

export const CameraSchema = z.object({
  x: FiniteNumberSchema,
  y: FiniteNumberSchema,
  scale: z.number().finite().min(MIN_SCALE).max(MAX_SCALE),
});

export const PointSchema = z.object({ x: FiniteNumberSchema, y: FiniteNumberSchema });
export const ViewportSchema = z.object({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});

const mediaTypes = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const AssetSchema = z.object({
  id: CanonicalUuidSchema,
  filename: z.string().min(1),
  mediaType: z.enum(mediaTypes),
  pixelWidth: PositiveIntegerSchema,
  pixelHeight: PositiveIntegerSchema,
  byteSize: PositiveIntegerSchema,
  importedAt: IsoTimestampSchema,
}).superRefine((asset, ctx) => {
  const extension = asset.mediaType === 'image/png' ? 'png'
    : asset.mediaType === 'image/jpeg' ? 'jpg' : 'webp';
  if (asset.filename !== `${asset.id}.${extension}`) {
    ctx.addIssue({ code: 'custom', path: ['filename'], message: 'filename must match the asset UUID and media type' });
  }
});

export const BoardItemSchema = z.object({
  id: CanonicalUuidSchema,
  assetId: CanonicalUuidSchema,
  x: FiniteNumberSchema,
  y: FiniteNumberSchema,
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  zIndex: z.number().int().nonnegative(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});

export const BoardDocumentSchema = z.object({
  schemaVersion: z.literal(BOARD_SCHEMA_VERSION),
  revision: z.number().int().nonnegative(),
  camera: CameraSchema,
  assets: z.array(AssetSchema),
  items: z.array(BoardItemSchema),
}).superRefine((document, ctx) => {
  const assetIds = new Set<string>();
  document.assets.forEach((asset, index) => {
    if (assetIds.has(asset.id)) ctx.addIssue({ code: 'custom', path: ['assets', index, 'id'], message: 'asset IDs must be unique' });
    assetIds.add(asset.id);
  });
  const itemIds = new Set<string>();
  document.items.forEach((item, index) => {
    if (itemIds.has(item.id)) ctx.addIssue({ code: 'custom', path: ['items', index, 'id'], message: 'item IDs must be unique' });
    itemIds.add(item.id);
    if (!assetIds.has(item.assetId)) ctx.addIssue({ code: 'custom', path: ['items', index, 'assetId'], message: 'item references an unknown asset' });
    if (item.zIndex !== index) ctx.addIssue({ code: 'custom', path: ['items', index, 'zIndex'], message: 'z-index must match sorted item position' });
  });
});

export const WindowSettingsSchema = z.object({
  bounds: z.object({
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  }),
  alwaysOnTop: z.boolean(),
});

export const UserErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  action: z.enum(['retry-load', 'retry-save', 'retry-close', 'retry-open-library', 'open-library', 'dismiss']),
});

export const ImportRejectionSchema = z.object({
  sourceName: z.string(),
  code: z.string().min(1),
  message: z.string().min(1),
});
export const ImportBatchResultSchema = z.object({
  imported: z.array(AssetSchema),
  rejected: z.array(ImportRejectionSchema),
});
export const LoadBoardResultSchema = z.object({
  document: BoardDocumentSchema,
  recovery: z.enum(['primary', 'backup', 'empty']),
  recoveryMessage: z.string().nullable(),
  missingAssetIds: z.array(CanonicalUuidSchema),
});
export const ShortcutStatusSchema = z.object({ registered: z.boolean(), message: z.string().nullable() });
export const RuntimeStatusSchema = z.object({ alwaysOnTop: z.boolean(), shortcut: ShortcutStatusSchema });

export const PasteRequestSchema = z.void();
export const DropRequestSchema = z.array(z.string().max(32_767).regex(/^[A-Za-z]:[\\/]/, 'expected a Windows drive-letter absolute path')).min(1).max(32);
export const SaveBoardRequestSchema = BoardDocumentSchema;
export const SetPinnedRequestSchema = z.object({ value: z.boolean() }).strict();

export const ResultSchema = <T extends z.ZodType>(valueSchema: T) => z.union([
  z.object({ ok: z.literal(true), value: valueSchema }),
  z.object({ ok: z.literal(false), error: UserErrorSchema }),
]);
export const RevisionSchema = z.object({ revision: z.number().int().nonnegative() });
export const FlushRequestSchema = CanonicalUuidSchema;
export const FlushResponseSchema = z.object({ token: CanonicalUuidSchema, result: ResultSchema(RevisionSchema) });
export const ShortcutStatusEventSchema = ShortcutStatusSchema;
export const MainErrorEventSchema = UserErrorSchema;

export type Camera = z.infer<typeof CameraSchema>;
export type Point = z.infer<typeof PointSchema>;
export type Viewport = z.infer<typeof ViewportSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type BoardItem = z.infer<typeof BoardItemSchema>;
export type BoardDocument = z.infer<typeof BoardDocumentSchema>;
export type WindowSettings = z.infer<typeof WindowSettingsSchema>;
export type UserError = z.infer<typeof UserErrorSchema>;
export type ImportRejection = z.infer<typeof ImportRejectionSchema>;
export type ImportBatchResult = z.infer<typeof ImportBatchResultSchema>;
export type LoadBoardResult = z.infer<typeof LoadBoardResultSchema>;
export type ShortcutStatus = z.infer<typeof ShortcutStatusSchema>;
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;
export type PasteRequest = z.infer<typeof PasteRequestSchema>;
export type DropRequest = z.infer<typeof DropRequestSchema>;
export type SaveBoardRequest = z.infer<typeof SaveBoardRequestSchema>;
export type SetPinnedRequest = z.infer<typeof SetPinnedRequestSchema>;
export type FlushResponse = z.infer<typeof FlushResponseSchema>;
export type Result<T> = { ok: true; value: T } | { ok: false; error: UserError };
export type Placement = { point: Point; camera: Camera; viewport: Viewport; offsetIndex: number };
