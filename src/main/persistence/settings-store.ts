import { readFile } from 'node:fs/promises';
import { WindowSettingsSchema, type Result, type WindowSettings } from '../../shared/contracts';
import { writeDurableJson } from './atomic-file';
import type { PersistencePaths } from './paths';

export const defaultWindowSettings = (): WindowSettings => ({
  bounds: { x: 100, y: 100, width: 1200, height: 800 },
  alwaysOnTop: false,
});

const failure = <T>(code: string, message: string, action: 'retry-save' | 'dismiss'): Result<T> => ({
  ok: false,
  error: { code, message, action },
});

export class SettingsStore {
  private queue: Promise<void> = Promise.resolve();

  public constructor(private readonly paths: PersistencePaths) {}

  public async load(): Promise<WindowSettings> {
    let text: string;
    try {
      text = await readFile(this.paths.settings, 'utf8');
    } catch (error: unknown) {
      if (isMissing(error)) return defaultWindowSettings();
      throw error;
    }

    try {
      const parsed = WindowSettingsSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : defaultWindowSettings();
    } catch {
      return defaultWindowSettings();
    }
  }

  public async save(settings: WindowSettings): Promise<Result<void>> {
    const parsed = WindowSettingsSchema.safeParse(settings);
    if (!parsed.success) return failure('SETTINGS_INVALID', 'The window settings are invalid and were not saved.', 'dismiss');
    return this.enqueue(async () => {
      try {
        await writeDurableJson(this.paths.settings, JSON.stringify(parsed.data));
        return { ok: true, value: undefined };
      } catch {
        return failure('SETTINGS_SAVE_FAILED', 'The window settings could not be saved.', 'retry-save');
      }
    });
  }

  private enqueue<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
    const result = this.queue.then(work, work);
    this.queue = result.then(() => undefined, () => undefined);
    return result.catch(() => failure('SETTINGS_SAVE_FAILED', 'The window settings could not be saved.', 'retry-save'));
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
