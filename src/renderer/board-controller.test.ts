import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Asset, BoardDocument, Result, UserError } from '../shared/contracts';
import { emptyBoard } from '../shared/board';
import { useBoardController } from './board-controller';

const userError = (code: string, action: UserError['action'] = 'dismiss'): UserError => ({ code, message: code, action });
const asset = (id = '11111111-1111-4111-8111-111111111111'): Asset => ({
  id, filename: `${id}.png`, mediaType: 'image/png', pixelWidth: 100, pixelHeight: 50, byteSize: 100,
  importedAt: '2026-09-07T00:00:00.000Z',
});
const documentWithItem = (): BoardDocument => {
  const image = asset();
  return {
    ...emptyBoard(), assets: [image], items: [{
      id: '22222222-2222-4222-8222-222222222222', assetId: image.id, x: 0, y: 0, width: 100, height: 50, zIndex: 0,
      createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z',
    }],
  };
};

function setup(document: BoardDocument = documentWithItem()) {
  const shortcutListeners: Array<(value: { registered: boolean; message: string | null }) => void> = [];
  const errorListeners: Array<(value: UserError) => void> = [];
  const flushListeners: Array<() => Promise<Result<{ revision: number }>>> = [];
  const cleanups: Array<ReturnType<typeof vi.fn>> = [];
  window.referenzio = {
    loadBoard: vi.fn().mockResolvedValue({ ok: true, value: { document, recovery: 'primary', recoveryMessage: null, missingAssetIds: [] } }),
    getRuntimeStatus: vi.fn().mockResolvedValue({ ok: true, value: { alwaysOnTop: false, shortcut: { registered: true, message: null } } }),
    pasteClipboardImage: vi.fn().mockResolvedValue({ ok: true, value: asset('33333333-3333-4333-8333-333333333333') }),
    importDroppedImages: vi.fn().mockResolvedValue({ ok: true, value: { imported: [], rejected: [] } }),
    saveBoard: vi.fn().mockImplementation(async (value: BoardDocument) => ({ ok: true, value: { revision: value.revision } })),
    setPinned: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    openLibraryFolder: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    minimizeWindow: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    closeWindow: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    onShortcutStatus: vi.fn((listener) => { shortcutListeners.push(listener); const unsubscribe = vi.fn(() => shortcutListeners.splice(shortcutListeners.indexOf(listener), 1)); cleanups.push(unsubscribe); return unsubscribe; }),
    onMainError: vi.fn((listener) => { errorListeners.push(listener); const unsubscribe = vi.fn(() => errorListeners.splice(errorListeners.indexOf(listener), 1)); cleanups.push(unsubscribe); return unsubscribe; }),
    onFlushRequest: vi.fn((listener) => { flushListeners.push(listener); const unsubscribe = vi.fn(() => flushListeners.splice(flushListeners.indexOf(listener), 1)); cleanups.push(unsubscribe); return unsubscribe; }),
  };
  return { shortcutListeners, errorListeners, flushListeners, cleanups };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useBoardController', () => {
  it('saves a completed drag immediately but coalesces camera changes for 300 ms', async () => {
    setup();
    const { result } = renderHook(() => useBoardController());
    await waitFor(() => expect(result.current.loadState).toBe('ready'));
    vi.useFakeTimers();
    act(() => result.current.moveItem('22222222-2222-4222-8222-222222222222', { x: 30, y: 40 }));
    await act(async () => {});
    expect(window.referenzio.saveBoard).toHaveBeenCalledTimes(1);
    act(() => result.current.panCamera({ x: 1, y: 0 }));
    act(() => result.current.panCamera({ x: 2, y: 0 }));
    expect(window.referenzio.saveBoard).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(window.referenzio.saveBoard).toHaveBeenCalledTimes(2);
  });

  it('does not label an unsent camera revision saved when an older save completes', async () => {
    setup();
    const { promise, resolve } = Promise.withResolvers<Result<{ revision: number }>>();
    vi.mocked(window.referenzio.saveBoard).mockReturnValueOnce(promise);
    const { result } = renderHook(() => useBoardController());
    await waitFor(() => expect(result.current.loadState).toBe('ready'));
    act(() => result.current.moveItem('22222222-2222-4222-8222-222222222222', { x: 30, y: 40 }));
    const submitted = result.current.document!.revision;
    act(() => result.current.panCamera({ x: 10, y: 0 }));
    await act(async () => resolve({ ok: true, value: { revision: submitted } }));
    expect(result.current.saveState).not.toBe('saved');
  });

  it('does not invent a document or call imports while loading', async () => {
    const pending = Promise.withResolvers<Result<import('../shared/contracts').LoadBoardResult>>();
    setup();
    vi.mocked(window.referenzio.loadBoard).mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useBoardController());
    act(() => result.current.pasteClipboard({ point: { x: 0, y: 0 }, camera: { x: 0, y: 0, scale: 1 }, viewport: { width: 100, height: 100 }, offsetIndex: 0 }));
    expect(result.current.document).toBeNull();
    expect(window.referenzio.pasteClipboardImage).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ ok: true, value: { document: documentWithItem(), recovery: 'primary', recoveryMessage: null, missingAssetIds: [] } }));
  });

  it('keeps one save error and retries it immediately', async () => {
    setup();
    vi.mocked(window.referenzio.saveBoard).mockResolvedValueOnce({ ok: false, error: userError('SAVE_FAILED', 'retry-save') });
    const { result } = renderHook(() => useBoardController());
    await waitFor(() => expect(result.current.loadState).toBe('ready'));
    vi.useFakeTimers();
    act(() => result.current.moveItem('22222222-2222-4222-8222-222222222222', { x: 30, y: 40 }));
    await act(async () => {});
    expect(result.current.saveState).toBe('unsaved');
    expect(result.current.errors.filter((error) => error.action === 'retry-save')).toHaveLength(1);
    act(() => result.current.retrySave());
    await act(async () => {});
    expect(result.current.saveState).toBe('saved');
    expect(result.current.errors.filter((error) => error.action === 'retry-save')).toHaveLength(0);
  });

  it('splits drops into sequential 32-file chunks with continuous placement offsets', async () => {
    setup(emptyBoard());
    const first = Array.from({ length: 32 }, (_, index) => asset(`10000000-0000-4000-8000-${String(index).padStart(12, '0')}`));
    const second = Array.from({ length: 18 }, (_, index) => asset(`20000000-0000-4000-8000-${String(index).padStart(12, '0')}`));
    vi.mocked(window.referenzio.importDroppedImages).mockResolvedValueOnce({ ok: true, value: { imported: first, rejected: [] } }).mockResolvedValueOnce({ ok: true, value: { imported: second, rejected: [] } });
    const { result } = renderHook(() => useBoardController());
    await waitFor(() => expect(result.current.loadState).toBe('ready'));
    const files = Array.from({ length: 50 }, (_, index) => new File(['x'], `${index}.png`, { type: 'image/png' }));
    act(() => result.current.importDroppedFiles(files, { point: { x: 0, y: 0 }, camera: { x: 0, y: 0, scale: 1 }, viewport: { width: 800, height: 600 }, offsetIndex: 7 }));
    await waitFor(() => expect(result.current.document?.items).toHaveLength(50));
    expect(window.referenzio.importDroppedImages).toHaveBeenCalledTimes(2);
    expect(vi.mocked(window.referenzio.importDroppedImages).mock.calls.map(([chunk]) => chunk.length)).toEqual([32, 18]);
    expect(result.current.document!.items[32].x).toBe(886);
    expect(result.current.importProgress).toBeNull();
  });

  it('flushes the latest camera revision and exposes all bridge subscriptions', async () => {
    const events = setup();
    const { result } = renderHook(() => useBoardController());
    await waitFor(() => expect(result.current.loadState).toBe('ready'));
    vi.useFakeTimers();
    act(() => result.current.panCamera({ x: 10, y: 0 }));
    await act(async () => expect(events.flushListeners[0]()).resolves.toMatchObject({ ok: true, value: { revision: 1 } }));
    expect(window.referenzio.saveBoard).toHaveBeenCalledOnce();
    expect(result.current.isClosing).toBe(true);
    act(() => events.shortcutListeners[0]({ registered: false, message: 'Collision' }));
    expect(result.current.shortcutStatus).toEqual({ registered: false, message: 'Collision' });
    act(() => events.errorListeners[0](userError('CLOSE_FAILED', 'retry-close')));
    expect(result.current.isClosing).toBe(false);
  });

  it('retries only a failed board load and retries runtime status without replacing edits', async () => {
    setup();
    vi.mocked(window.referenzio.loadBoard).mockResolvedValueOnce({ ok: false, error: userError('LOAD_FAILED', 'retry-load') });
    vi.mocked(window.referenzio.getRuntimeStatus).mockResolvedValueOnce({ ok: false, error: userError('RUNTIME_FAILED') });
    const { result } = renderHook(() => useBoardController());
    await waitFor(() => expect(result.current.loadState).toBe('error'));
    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.loadState).toBe('ready'));
    act(() => result.current.moveItem('22222222-2222-4222-8222-222222222222', { x: 30, y: 40 }));
    const editedRevision = result.current.document!.revision;
    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.runtimeStatusReady).toBe(true));
    expect(window.referenzio.loadBoard).toHaveBeenCalledTimes(2);
    expect(window.referenzio.getRuntimeStatus).toHaveBeenCalledTimes(2);
    expect(result.current.document!.revision).toBe(editedRevision);
  });

  it('preserves partial drop successes and completes a close after a late accepted import', async () => {
    const events = setup(emptyBoard());
    const pending = Promise.withResolvers<Result<import('../shared/contracts').ImportBatchResult>>();
    vi.mocked(window.referenzio.importDroppedImages).mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ok: false, error: userError('CHUNK_FAILED') });
    const { result } = renderHook(() => useBoardController());
    await waitFor(() => expect(result.current.loadState).toBe('ready'));
    const files = Array.from({ length: 33 }, (_, index) => new File(['x'], `${index}.png`, { type: 'image/png' }));
    act(() => result.current.importDroppedFiles(files, { point: { x: 0, y: 0 }, camera: { x: 0, y: 0, scale: 1 }, viewport: { width: 400, height: 400 }, offsetIndex: 0 }));
    let close!: Promise<Result<{ revision: number }>>;
    await act(async () => { close = events.flushListeners[0](); });
    expect(result.current.isClosing).toBe(true);
    act(() => events.errorListeners[0](userError('CLOSE_TIMEOUT', 'retry-close')));
    await act(async () => pending.resolve({ ok: true, value: { imported: [asset('44444444-4444-4444-8444-444444444444')], rejected: [] } }));
    await expect(close).resolves.toMatchObject({ ok: true, value: { revision: 1 } });
    expect(result.current.isClosing).toBe(false);
    expect(result.current.document!.items).toHaveLength(1);
    expect(result.current.errors.some((error) => error.code === 'DROP_IMPORT_FAILED')).toBe(true);
  });

  it('maps explicit error actions and clears StrictMode subscriptions on remount', async () => {
    const events = setup();
    const { result, unmount } = renderHook(() => useBoardController(), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.loadState).toBe('ready'));
    act(() => result.current.runErrorAction(userError('OPEN', 'open-library')));
    act(() => result.current.runErrorAction(userError('CLOSE', 'retry-close')));
    await waitFor(() => expect(window.referenzio.openLibraryFolder).toHaveBeenCalledOnce());
    expect(window.referenzio.closeWindow).toHaveBeenCalledOnce();
    expect(window.referenzio.onShortcutStatus).toHaveBeenCalledTimes(2);
    unmount();
    expect(events.cleanups).toHaveLength(6);
    expect(events.cleanups.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true);
  });
});
