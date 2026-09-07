import { useEffect, useRef, useState } from 'react';
import {
  addItems, deleteItem, fitBoardCamera, moveItem as moveBoardItem, reorderItem, resizeItem as resizeBoardItem, zoomAtPoint,
} from '../shared/board';
import type {
  Asset, BoardDocument, Camera, ImportRejection, Placement, Point, Result, RuntimeStatus, ShortcutStatus, UserError, Viewport,
} from '../shared/contracts';

type LoadState = 'loading' | 'ready' | 'recovered' | 'error';
type SaveState = 'saved' | 'saving' | 'unsaved';
type ImportProgress = { completed: number; total: number };

const RETRY_DELAYS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
const unavailableError: UserError = {
  code: 'BOARD_NOT_READY', message: 'The canvas is still loading.', action: 'dismiss',
};
const operationError = (code: string, message: string, action: UserError['action'] = 'dismiss'): UserError => ({ code, message, action });

export function useBoardController() {
  const [document, setDocument] = useState<BoardDocument | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [missingAssetIds, setMissingAssetIds] = useState<string[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [shortcutStatus, setShortcutStatus] = useState<ShortcutStatus>({ registered: false, message: null });
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [runtimeStatusReady, setRuntimeStatusReady] = useState(false);
  const [errors, setErrors] = useState<UserError[]>([]);
  const [isClosing, setIsClosing] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);

  const documentRef = useRef<BoardDocument | null>(null);
  const acknowledgedRevisionRef = useRef(0);
  const pendingSaveRef = useRef<BoardDocument | null>(null);
  const inFlightSaveRef = useRef<BoardDocument | null>(null);
  const retryIndexRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeImportsRef = useRef(new Set<Promise<void>>());
  const initializationRef = useRef<Promise<void> | null>(null);
  const boardLoadFailedRef = useRef(false);
  const runtimeLoadFailedRef = useRef(false);
  const isClosingRef = useRef(false);
  const isMountedRef = useRef(false);
  const attemptRef = useRef(0);
  const boardRequestRef = useRef(0);
  const runtimeRequestRef = useRef(0);
  const unsubscribeRef = useRef<Array<() => void>>([]);
  const saveWaitersRef = useRef(new Map<number, Array<(result: Result<{ revision: number }>) => void>>());
  const saveFailureRef = useRef<UserError | null>(null);

  const addError = (error: UserError) => {
    if (!isMountedRef.current) return;
    setErrors((current) => [...current, error]);
  };
  const replaceActionError = (action: UserError['action'], error: UserError | null) => {
    if (!isMountedRef.current) return;
    setErrors((current) => [...current.filter((candidate) => candidate.action !== action), ...(error ? [error] : [])]);
  };
  const setSaveFailure = (error: UserError | null) => {
    if (!isMountedRef.current) return;
    const previous = saveFailureRef.current;
    saveFailureRef.current = error;
    setErrors((current) => [...current.filter((candidate) => candidate !== previous), ...(error ? [error] : [])]);
  };
  const clearTimers = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    debounceTimerRef.current = null;
    retryTimerRef.current = null;
  };
  const setCurrentDocument = (next: BoardDocument) => {
    documentRef.current = next;
    if (isMountedRef.current) setDocument(next);
  };
  const markDirty = () => {
    if (isMountedRef.current) setSaveState('unsaved');
  };
  const resolveSaveWaiters = (revision: number, result: Result<{ revision: number }>) => {
    const waiters = saveWaitersRef.current.get(revision);
    if (!waiters) return;
    saveWaitersRef.current.delete(revision);
    waiters.forEach((resolve) => resolve(result));
  };
  const waitForSave = (revision: number) => new Promise<Result<{ revision: number }>>((resolve) => {
    const current = saveWaitersRef.current.get(revision) ?? [];
    current.push(resolve);
    saveWaitersRef.current.set(revision, current);
  });

  const startSave = () => {
    if (inFlightSaveRef.current || !pendingSaveRef.current) return;
    const snapshot = pendingSaveRef.current;
    pendingSaveRef.current = null;
    inFlightSaveRef.current = snapshot;
    if (isMountedRef.current) setSaveState('saving');
    void window.referenzio.saveBoard(snapshot).then((result) => {
      inFlightSaveRef.current = null;
      resolveSaveWaiters(snapshot.revision, result);
      if (!isMountedRef.current) return;
      const current = documentRef.current;
      if (result.ok) {
        acknowledgedRevisionRef.current = Math.max(acknowledgedRevisionRef.current, result.value.revision);
        retryIndexRef.current = 0;
        if (current && current.revision === acknowledgedRevisionRef.current && !pendingSaveRef.current) {
          setSaveState('saved');
          setSaveFailure(null);
        } else {
          setSaveState('unsaved');
        }
      } else if (current && current.revision > acknowledgedRevisionRef.current) {
        setSaveState('unsaved');
        if (current.revision === snapshot.revision && !pendingSaveRef.current) {
          setSaveFailure(result.error);
        }
        if (current.revision === snapshot.revision && !pendingSaveRef.current && !retryTimerRef.current) {
          const delay = RETRY_DELAYS[Math.min(retryIndexRef.current, RETRY_DELAYS.length - 1)];
          retryIndexRef.current += 1;
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            if (!documentRef.current || acknowledgedRevisionRef.current === documentRef.current.revision) return;
            pendingSaveRef.current = documentRef.current;
            startSave();
          }, delay);
        }
      }
      if (pendingSaveRef.current) startSave();
    }).catch(() => {
      const error = operationError('SAVE_TRANSPORT_FAILED', 'The canvas could not be saved.');
      inFlightSaveRef.current = null;
      resolveSaveWaiters(snapshot.revision, { ok: false, error });
      if (!isMountedRef.current || !documentRef.current) return;
      setSaveState('unsaved');
      if (documentRef.current.revision === snapshot.revision && !pendingSaveRef.current) {
        setSaveFailure(error);
      }
      if (documentRef.current.revision === snapshot.revision && !pendingSaveRef.current && !retryTimerRef.current) {
        const delay = RETRY_DELAYS[Math.min(retryIndexRef.current++, RETRY_DELAYS.length - 1)];
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          if (documentRef.current) { pendingSaveRef.current = documentRef.current; startSave(); }
        }, delay);
      }
      if (pendingSaveRef.current) startSave();
    });
  };

  const requestSave = (mode: 'immediate' | 'debounced', snapshot = documentRef.current) => {
    if (!snapshot) return;
    markDirty();
    if (mode === 'debounced') {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (!documentRef.current) return;
        pendingSaveRef.current = documentRef.current;
        startSave();
      }, 300);
      return;
    }
    if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
    pendingSaveRef.current = snapshot;
    startSave();
  };

  const editDocument = (transform: (current: BoardDocument) => BoardDocument, mode: 'immediate' | 'debounced', allowClosing = false) => {
    const current = documentRef.current;
    if (!current || (isClosingRef.current && !allowClosing)) return false;
    try {
      const next = transform(current);
      if (next === current) return false;
      setCurrentDocument(next);
      requestSave(mode, next);
      return true;
    } catch {
      addError(operationError('BOARD_COMMAND_FAILED', 'The canvas change could not be applied.'));
      return false;
    }
  };

  const mergeImportedAssets = (assets: Asset[], placement: Placement) => {
    if (!assets.length || !documentRef.current) return false;
    const changed = editDocument((current) => addItems(current, assets, placement), 'immediate', true);
    if (changed && isMountedRef.current) setSelectedItemId(documentRef.current!.items.at(-1)?.id ?? null);
    return changed;
  };

  const waitForAcceptedImports = async () => {
    while (activeImportsRef.current.size) await Promise.allSettled([...activeImportsRef.current]);
  };

  const flushPendingSave = async (): Promise<Result<{ revision: number }>> => {
    if (initializationRef.current) await initializationRef.current;
    await waitForAcceptedImports();
    if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    const current = documentRef.current;
    if (!current) return { ok: true, value: { revision: 0 } };
    if (acknowledgedRevisionRef.current === current.revision && !inFlightSaveRef.current && !pendingSaveRef.current) {
      return { ok: true, value: { revision: current.revision } };
    }
    const waiting = waitForSave(current.revision);
    if (inFlightSaveRef.current?.revision === current.revision && !pendingSaveRef.current) return waiting;
    pendingSaveRef.current = current;
    startSave();
    return waiting;
  };

  const applyBoardLoad = (result: Result<import('../shared/contracts').LoadBoardResult>, token: number, request: number) => {
    if (!isMountedRef.current || token !== attemptRef.current || request !== boardRequestRef.current) return;
    if (!result.ok) {
      boardLoadFailedRef.current = true;
      setLoadState('error');
      replaceActionError('retry-load', result.error);
      return;
    }
    boardLoadFailedRef.current = false;
    setCurrentDocument(result.value.document);
    acknowledgedRevisionRef.current = result.value.document.revision;
    pendingSaveRef.current = null;
    inFlightSaveRef.current = null;
    setSaveState('saved');
    setMissingAssetIds(result.value.missingAssetIds);
    setLoadState(result.value.recovery !== 'primary' && result.value.recoveryMessage ? 'recovered' : 'ready');
    setRecoveryMessage(result.value.recoveryMessage);
    replaceActionError('retry-load', null);
  };
  const applyRuntimeStatus = (result: Result<RuntimeStatus>, token: number, request: number) => {
    if (!isMountedRef.current || token !== attemptRef.current || request !== runtimeRequestRef.current) return;
    if (!result.ok) {
      runtimeLoadFailedRef.current = true;
      setRuntimeStatusReady(false);
      addError(result.error);
      return;
    }
    runtimeLoadFailedRef.current = false;
    setAlwaysOnTop(result.value.alwaysOnTop);
    setShortcutStatus(result.value.shortcut);
    setRuntimeStatusReady(true);
  };

  useEffect(() => {
    isMountedRef.current = true;
    const token = ++attemptRef.current;
    const boardRequest = ++boardRequestRef.current;
    const runtimeRequest = ++runtimeRequestRef.current;
    const load = window.referenzio.loadBoard();
    const runtime = window.referenzio.getRuntimeStatus();
    const initialize = Promise.all([load, runtime]).then(([boardResult, runtimeResult]) => {
      applyBoardLoad(boardResult, token, boardRequest);
      applyRuntimeStatus(runtimeResult, token, runtimeRequest);
    }).catch(() => {
      applyBoardLoad({ ok: false, error: operationError('LOAD_TRANSPORT_FAILED', 'The canvas could not be loaded.', 'retry-load') }, token, boardRequest);
    });
    initializationRef.current = initialize;
    const unsubscribers = [
      window.referenzio.onShortcutStatus((status) => { if (isMountedRef.current) setShortcutStatus(status); }),
      window.referenzio.onMainError((error) => {
        if (!isMountedRef.current) return;
        addError(error);
        if (error.action === 'retry-close') {
          isClosingRef.current = false;
          setIsClosing(false);
        }
      }),
      window.referenzio.onFlushRequest(async () => {
        isClosingRef.current = true;
        if (isMountedRef.current) setIsClosing(true);
        return flushPendingSave();
      }),
    ];
    unsubscribeRef.current = unsubscribers;
    return () => {
      isMountedRef.current = false;
      clearTimers();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      if (unsubscribeRef.current === unsubscribers) unsubscribeRef.current = [];
    };
  }, []);

  const retryLoad = () => {
    const token = attemptRef.current;
    if (!documentRef.current && boardLoadFailedRef.current) {
      const request = ++boardRequestRef.current;
      initializationRef.current = window.referenzio.loadBoard().then(
        (result) => applyBoardLoad(result, token, request),
        () => applyBoardLoad({ ok: false, error: operationError('LOAD_TRANSPORT_FAILED', 'The canvas could not be loaded.', 'retry-load') }, token, request),
      );
    } else if (documentRef.current && runtimeLoadFailedRef.current) {
      const request = ++runtimeRequestRef.current;
      initializationRef.current = window.referenzio.getRuntimeStatus().then(
        (result) => applyRuntimeStatus(result, token, request),
        () => applyRuntimeStatus({ ok: false, error: operationError('RUNTIME_TRANSPORT_FAILED', 'Window controls are unavailable.') }, token, request),
      );
    }
  };
  const retrySave = () => {
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    if (!documentRef.current || acknowledgedRevisionRef.current === documentRef.current.revision) return;
    pendingSaveRef.current = documentRef.current;
    startSave();
  };
  const addImportedAssets = (assets: Asset[], placement: Placement) => {
    if (!documentRef.current || isClosingRef.current) { addError(unavailableError); return; }
    mergeImportedAssets(assets, placement);
  };
  const pasteClipboard = (placement: Placement) => {
    if (!documentRef.current || isClosingRef.current) { addError(unavailableError); return; }
    let operation: Promise<void>;
    operation = (async () => {
      try {
        const result = await window.referenzio.pasteClipboardImage();
        if (!result.ok) { addError(result.error); return; }
        mergeImportedAssets([result.value], placement);
      } catch {
        addError(operationError('PASTE_TRANSPORT_FAILED', 'The clipboard image could not be imported.'));
      }
    })().finally(() => activeImportsRef.current.delete(operation));
    activeImportsRef.current.add(operation);
  };
  const importDroppedFiles = (files: File[], placement: Placement) => {
    if (!documentRef.current || isClosingRef.current) { addError(unavailableError); return; }
    let operation: Promise<void>;
    operation = (async () => {
      let offsetIndex = placement.offsetIndex;
      let completed = 0;
      if (isMountedRef.current) setImportProgress({ completed, total: files.length });
      try {
        for (let index = 0; index < files.length; index += 32) {
          const chunk = files.slice(index, index + 32);
          try {
            const result = await window.referenzio.importDroppedImages(chunk);
            if (!result.ok) {
              addError(operationError('DROP_IMPORT_FAILED', `Could not import: ${chunk.map((file) => file.name).join(', ')}.`, 'dismiss'));
            } else {
              result.value.rejected.forEach((rejection: ImportRejection) => addError({ code: rejection.code, message: `${rejection.sourceName}: ${rejection.message}`, action: 'dismiss' }));
              if (result.value.imported.length) {
                mergeImportedAssets(result.value.imported, { ...placement, offsetIndex });
                offsetIndex += result.value.imported.length;
              }
            }
          } catch {
            addError(operationError('DROP_TRANSPORT_FAILED', `Could not import: ${chunk.map((file) => file.name).join(', ')}.`));
          } finally {
            completed += chunk.length;
            if (isMountedRef.current) setImportProgress({ completed, total: files.length });
          }
        }
      } finally {
        if (isMountedRef.current) setImportProgress(null);
      }
    })().finally(() => activeImportsRef.current.delete(operation));
    activeImportsRef.current.add(operation);
  };
  const setPinned = (value: boolean) => {
    if (!runtimeStatusReady || isClosingRef.current) return;
    void window.referenzio.setPinned(value).then((result) => {
      if (!result.ok) { addError(result.error); return; }
      if (isMountedRef.current) setAlwaysOnTop(value);
    }).catch(() => addError(operationError('PIN_TRANSPORT_FAILED', 'The window pin could not be changed.')));
  };
  const openLibraryFolder = () => {
    void window.referenzio.openLibraryFolder().then((result) => { if (!result.ok) addError(result.error); }).catch(() => addError(operationError('OPEN_LIBRARY_FAILED', 'The library folder could not be opened.', 'retry-open-library')));
  };
  const dismissError = (error: UserError) => setErrors((current) => current.filter((candidate) => candidate !== error));
  const runErrorAction = (error: UserError) => {
    switch (error.action) {
      case 'retry-load': retryLoad(); break;
      case 'retry-save': retrySave(); break;
      case 'retry-close': void window.referenzio.closeWindow(); break;
      case 'retry-open-library':
      case 'open-library': openLibraryFolder(); break;
      case 'dismiss': dismissError(error); break;
    }
  };
  const dispose = () => {
    clearTimers();
    unsubscribeRef.current.forEach((unsubscribe) => unsubscribe());
    unsubscribeRef.current = [];
  };

  return {
    document, selectedItemId, missingAssetIds, loadState, recoveryMessage, saveState, shortcutStatus, alwaysOnTop, runtimeStatusReady, errors, isClosing, importProgress,
    selectItem: (itemId: string) => setSelectedItemId(itemId),
    clearSelection: () => setSelectedItemId(null),
    panCamera: (delta: Point) => editDocument((current) => ({ ...current, revision: current.revision + 1, camera: { ...current.camera, x: current.camera.x + delta.x, y: current.camera.y + delta.y } }), 'debounced'),
    zoomCameraAt: (pointer: Point, scale: number) => editDocument((current) => {
      const camera: Camera = zoomAtPoint(current.camera, pointer, scale);
      return camera === current.camera ? current : { ...current, revision: current.revision + 1, camera };
    }, 'debounced'),
    fitBoard: (viewport: Viewport) => editDocument((current) => {
      const camera = fitBoardCamera(current.items, viewport);
      return camera.x === current.camera.x && camera.y === current.camera.y && camera.scale === current.camera.scale ? current : { ...current, revision: current.revision + 1, camera };
    }, 'immediate'),
    addImportedAssets,
    pasteClipboard,
    importDroppedFiles,
    moveItem: (itemId: string, point: Point) => editDocument((current) => moveBoardItem(current, itemId, point), 'immediate'),
    resizeItem: (itemId: string, transform: { x: number; y: number; width: number }) => editDocument((current) => resizeBoardItem(current, itemId, transform), 'immediate'),
    deleteSelected: () => {
      const itemId = selectedItemId;
      if (itemId && editDocument((current) => deleteItem(current, itemId), 'immediate')) setSelectedItemId(null);
    },
    reorderSelected: (direction: 'front' | 'back' | 'forward' | 'backward') => {
      if (selectedItemId) editDocument((current) => reorderItem(current, selectedItemId, direction), 'immediate');
    },
    retryLoad, retrySave, flushPendingSave, openLibraryFolder, runErrorAction, dismissError, setPinned, dispose,
  };
}
