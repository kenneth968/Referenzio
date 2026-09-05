import sharp from 'sharp';
import { extname } from 'node:path';
import { MAX_IMPORT_BYTES, MAX_IMPORT_PIXELS, type Asset } from '../../shared/contracts';

export type ImageType = {
  extension: 'png' | 'jpg' | 'webp';
  format: 'png' | 'jpeg' | 'webp';
  mediaType: Asset['mediaType'];
  label: 'PNG' | 'JPEG' | 'WebP';
};

export type InspectionFailure = 'DECODE_FAILED' | 'TYPE_MISMATCH' | 'IMAGE_TOO_LARGE';
export type ImageInspection = { ok: true; width: number; height: number } | { ok: false; code: InspectionFailure };

const imageTypes: Record<string, ImageType> = {
  '.png': { extension: 'png', format: 'png', mediaType: 'image/png', label: 'PNG' },
  '.jpg': { extension: 'jpg', format: 'jpeg', mediaType: 'image/jpeg', label: 'JPEG' },
  '.jpeg': { extension: 'jpg', format: 'jpeg', mediaType: 'image/jpeg', label: 'JPEG' },
  '.webp': { extension: 'webp', format: 'webp', mediaType: 'image/webp', label: 'WebP' },
};

export function imageTypeForPath(path: string): ImageType | undefined {
  return imageTypes[extname(path).toLowerCase()];
}

export function isWithinByteLimit(byteSize: number): boolean {
  return byteSize <= MAX_IMPORT_BYTES;
}

export function isWithinPixelLimit(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width * height <= MAX_IMPORT_PIXELS;
}

export async function inspectImage(bytes: Uint8Array, expected: ImageType): Promise<ImageInspection> {
  try {
    const decoder = sharp(bytes, { failOn: 'error', limitInputPixels: MAX_IMPORT_PIXELS });
    const metadata = await decoder.metadata();
    if (metadata.format !== expected.format) return { ok: false, code: 'TYPE_MISMATCH' };
    if (!metadata.width || !metadata.height) return { ok: false, code: 'DECODE_FAILED' };
    if (!isWithinPixelLimit(metadata.width, metadata.height)) return { ok: false, code: 'IMAGE_TOO_LARGE' };
    await decoder.clone().raw().toBuffer();
    const rotated = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
    return { ok: true, width: rotated ? metadata.height : metadata.width, height: rotated ? metadata.width : metadata.height };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return { ok: false, code: message.includes('pixel limit') || message.includes('too many pixels') ? 'IMAGE_TOO_LARGE' : 'DECODE_FAILED' };
  }
}
