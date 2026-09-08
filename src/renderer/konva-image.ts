type CacheEntry = { promise: Promise<HTMLImageElement>; references: number };

const imageCache = new Map<string, CacheEntry>();

export function loadCanvasImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const decoded = typeof image.decode === 'function' ? image.decode() : Promise.resolve();
      void decoded.then(() => resolve(image), reject);
    };
    image.onerror = () => reject(new Error(`Could not load image: ${source}`));
    image.src = source;
  });
}

export function acquireCanvasImage(source: string): Promise<HTMLImageElement> {
  let entry = imageCache.get(source);
  if (!entry) {
    const promise = loadCanvasImage(source);
    entry = { promise, references: 0 };
    imageCache.set(source, entry);
    void promise.catch(() => {
      if (imageCache.get(source)?.promise === promise) imageCache.delete(source);
    });
  }
  entry.references += 1;
  return entry.promise;
}

export function releaseCanvasImage(source: string): void {
  const entry = imageCache.get(source);
  if (!entry) return;
  entry.references -= 1;
  if (entry.references <= 0) imageCache.delete(source);
}

export function resetCanvasImageCache(): void {
  imageCache.clear();
}
