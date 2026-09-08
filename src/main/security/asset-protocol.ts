import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { PersistenceService } from '../persistence';

const assetFilename = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/i;

export function registerAssetProtocol({ protocol, net, persistence }: {
  protocol: { handle(scheme: string, handler: (request: { url: string }) => Promise<Response>): void };
  net: { fetch(url: string): Promise<Response> };
  persistence: Pick<PersistenceService, 'assetPath'>;
}): void {
  protocol.handle('referenzio-asset', async (request) => {
    let filename: string;
    try {
      filename = decodeURIComponent(new URL(request.url).pathname.slice(1));
    } catch {
      return new Response('Not found', { status: 404 });
    }
    if (!assetFilename.test(filename)) return new Response('Not found', { status: 404 });
    try {
      const assetPath = persistence.assetPath(filename);
      await access(assetPath);
      return net.fetch(pathToFileURL(assetPath).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
