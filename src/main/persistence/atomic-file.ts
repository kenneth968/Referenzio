import { open, rename, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export type StagedFile = { path: string; destination: string };

/** Writes and flushes a uniquely named sibling file without replacing the destination. */
export async function stageDurableBytes(destination: string, bytes: Uint8Array): Promise<StagedFile> {
  const resolvedDestination = resolve(destination);
  const directory = dirname(resolvedDestination);
  const temporaryPath = resolve(directory, `.${basename(resolvedDestination)}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let failure: unknown;

  if (dirname(temporaryPath) !== directory) throw new Error('Temporary file must be a sibling of its destination.');

  try {
    handle = await open(temporaryPath, 'wx');
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    failure = error;
  }
  try {
    if (handle) await handle.close();
  } catch (error) {
    failure ??= error;
  }
  if (failure) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw failure;
  }
  return { path: temporaryPath, destination: resolvedDestination };
}

export async function replaceStagedFile(staged: StagedFile): Promise<void> {
  if (dirname(resolve(staged.path)) !== dirname(resolve(staged.destination))) {
    throw new Error('Staged file must be in the destination directory.');
  }
  await rename(staged.path, staged.destination);
}

export async function discardStagedFile(staged: StagedFile): Promise<void> {
  await rm(staged.path, { force: true }).catch(() => undefined);
}

export async function writeDurableBytes(destination: string, bytes: Uint8Array): Promise<void> {
  const staged = await stageDurableBytes(destination, bytes);
  try {
    await replaceStagedFile(staged);
  } catch (error) {
    await discardStagedFile(staged);
    throw error;
  }
}

export async function writeDurableJson(destination: string, text: string): Promise<void> {
  await writeDurableBytes(destination, Buffer.from(text, 'utf8'));
}
