import { access, readFile, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  BoardDocumentSchema,
  type BoardDocument,
  type LoadBoardResult,
  type Result,
} from '../../shared/contracts';
import { emptyBoard } from '../../shared/board';
import { discardStagedFile, replaceStagedFile, stageDurableBytes, writeDurableJson } from './atomic-file';
import type { PersistencePaths } from './paths';

type Snapshot = { kind: 'missing' } | { kind: 'valid'; document: BoardDocument } | { kind: 'invalid' };

const boardSaveFailure = <T>(): Result<T> => ({
  ok: false,
  error: { code: 'BOARD_SAVE_FAILED', message: 'The board could not be saved.', action: 'retry-save' },
});

export class BoardStore {
  private queue: Promise<void> = Promise.resolve();
  private lastCommittedRevision = 0;
  private highestRequestedRevision = 0;
  private needsPrimaryRepair = false;
  private hasValidPrimary = false;

  public constructor(
    private readonly paths: PersistencePaths,
    private readonly now: () => Date,
    private readonly ready: () => Promise<void>,
  ) {}

  public async load(): Promise<LoadBoardResult> {
    const primary = await this.readSnapshot(this.paths.board);
    if (primary.kind === 'valid') {
      this.setLoadedRevision(primary.document.revision, true, false);
      return this.result(primary.document, 'primary', null);
    }

    if (primary.kind === 'invalid') await this.preserveInvalidPrimary();

    const backup = await this.readSnapshot(this.paths.backup);
    if (backup.kind === 'valid') {
      this.setLoadedRevision(backup.document.revision, false, true);
      let message = 'Recovered the board from its backup copy.';
      try {
        // A recovered backup repairs only the primary; it must never overwrite the backup.
        await writeDurableJson(this.paths.board, JSON.stringify(backup.document));
        this.needsPrimaryRepair = false;
        this.hasValidPrimary = true;
      } catch {
        message = 'Recovered the board from its backup copy, but the primary snapshot still needs repair.';
      }
      return this.result(backup.document, 'backup', message);
    }

    this.setLoadedRevision(0, false, false);
    return this.result(
      emptyBoard(),
      'empty',
      primary.kind === 'missing' && backup.kind === 'missing'
        ? null
        : 'Board snapshots could not be recovered. Open the library to inspect the preserved files.',
    );
  }

  public save(document: BoardDocument): Promise<Result<{ revision: number }>> {
    const parsed = BoardDocumentSchema.safeParse(document);
    if (!parsed.success) {
      return Promise.resolve({
        ok: false,
        error: { code: 'BOARD_INVALID', message: 'The board data is invalid and was not saved.', action: 'dismiss' },
      });
    }

    this.highestRequestedRevision = Math.max(this.highestRequestedRevision, parsed.data.revision);
    return this.enqueue(async () => {
      try {
        await this.ready();
      } catch {
        this.needsPrimaryRepair = true;
        return boardSaveFailure<{ revision: number }>();
      }
      if (!this.needsPrimaryRepair && this.hasValidPrimary && parsed.data.revision <= this.lastCommittedRevision) {
        return { ok: true, value: { revision: this.lastCommittedRevision } };
      }
      if (parsed.data.revision < this.highestRequestedRevision) {
        return { ok: true, value: { revision: this.lastCommittedRevision } };
      }
      try {
        await this.commitBoardSnapshot(parsed.data);
        this.needsPrimaryRepair = false;
        this.hasValidPrimary = true;
        this.lastCommittedRevision = parsed.data.revision;
        return { ok: true, value: { revision: parsed.data.revision } };
      } catch {
        this.needsPrimaryRepair = true;
        return boardSaveFailure<{ revision: number }>();
      }
    });
  }

  public async flush(): Promise<Result<void>> {
    await this.queue;
    if (this.needsPrimaryRepair || this.lastCommittedRevision < this.highestRequestedRevision) return boardSaveFailure<void>();
    return { ok: true, value: undefined };
  }

  private enqueue<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
    const result = this.queue.then(work, work);
    this.queue = result.then(() => undefined, () => undefined);
    return result.catch(() => boardSaveFailure<T>());
  }

  private async commitBoardSnapshot(document: BoardDocument): Promise<void> {
    const staged = await stageDurableBytes(this.paths.board, Buffer.from(JSON.stringify(document), 'utf8'));
    try {
      const current = await this.readSnapshot(this.paths.board);
      if (current.kind === 'valid') {
        // The new primary is already flushed at this point. Only validated content becomes a backup.
        await writeDurableJson(this.paths.backup, JSON.stringify(current.document));
      } else if (current.kind === 'invalid') {
        await this.preserveInvalidPrimary();
      }
      await replaceStagedFile(staged);
    } catch (error) {
      await discardStagedFile(staged);
      throw error;
    }
  }

  private async readSnapshot(path: string): Promise<Snapshot> {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error: unknown) {
      if (isMissing(error)) return { kind: 'missing' };
      throw error;
    }
    try {
      const parsed = BoardDocumentSchema.safeParse(JSON.parse(text));
      return parsed.success ? { kind: 'valid', document: parsed.data } : { kind: 'invalid' };
    } catch {
      return { kind: 'invalid' };
    }
  }

  private async preserveInvalidPrimary(): Promise<void> {
    const timestamp = this.now().toISOString().replace(/:/g, '-');
    const directory = dirname(this.paths.board);
    const extension = '.json';
    const stem = `${basename(this.paths.board, extension)}.invalid-${timestamp}`;
    let attempt = 0;
    while (true) {
      const target = join(directory, `${stem}${attempt ? `-${attempt}` : ''}${extension}`);
      try {
        await rename(this.paths.board, target);
        return;
      } catch (error: unknown) {
        if (isAlreadyExists(error)) {
          attempt += 1;
          continue;
        }
        throw error;
      }
    }
  }

  private async result(document: BoardDocument, recovery: LoadBoardResult['recovery'], recoveryMessage: string | null): Promise<LoadBoardResult> {
    const missingAssetIds: string[] = [];
    for (const asset of document.assets) {
      try {
        await access(join(this.paths.assetsDirectory, asset.filename), constants.F_OK);
      } catch (error: unknown) {
        if (isMissing(error)) missingAssetIds.push(asset.id);
        else throw error;
      }
    }
    return { document, recovery, recoveryMessage, missingAssetIds };
  }

  private setLoadedRevision(revision: number, hasValidPrimary: boolean, needsPrimaryRepair: boolean): void {
    this.lastCommittedRevision = revision;
    this.highestRequestedRevision = revision;
    this.hasValidPrimary = hasValidPrimary;
    this.needsPrimaryRepair = needsPrimaryRepair;
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'EEXIST';
}
