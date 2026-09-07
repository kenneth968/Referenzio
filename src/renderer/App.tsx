import { useEffect, useRef, useState } from 'react';
import { worldPointForScreenPoint } from '../shared/board';
import type { Placement, Point, Viewport } from '../shared/contracts';
import { BoardCanvas } from './BoardCanvas';
import { useBoardController } from './board-controller';
import { NoticeCenter } from './ui/NoticeCenter';
import { TitleBar } from './ui/TitleBar';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement || target.isContentEditable;
}

export default function App() {
  const controller = useBoardController();
  const hostRef = useRef<HTMLDivElement>(null);
  const initiallyFocused = useRef(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [recoveryVisible, setRecoveryVisible] = useState(true);
  const [shortcutVisible, setShortcutVisible] = useState(true);
  const document = controller.document;
  const ready = document !== null && controller.loadState !== 'error';
  const interactionEnabled = ready && !controller.isClosing;

  useEffect(() => {
    if (!ready || initiallyFocused.current) return;
    hostRef.current?.focus();
    initiallyFocused.current = true;
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const focusCanvas = () => hostRef.current?.focus();
    const clearSpace = () => setSpacePressed(false);
    window.addEventListener('focus', focusCanvas);
    window.addEventListener('blur', clearSpace);
    return () => {
      window.removeEventListener('focus', focusCanvas);
      window.removeEventListener('blur', clearSpace);
    };
  }, [ready]);

  const viewport = (): Viewport => ({ width: Math.max(1, hostRef.current?.clientWidth ?? 1), height: Math.max(1, hostRef.current?.clientHeight ?? 1) });
  const placementAt = (screenPoint: Point): Placement | null => {
    if (!document) return null;
    const measured = viewport();
    return { point: worldPointForScreenPoint(document.camera, screenPoint), camera: { ...document.camera }, viewport: measured, offsetIndex: 0 };
  };
  const pasteAtCenter = () => {
    const measured = viewport();
    const placement = placementAt({ x: measured.width / 2, y: measured.height / 2 });
    if (placement) controller.pasteClipboard(placement);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!interactionEnabled || isEditableTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey && !event.altKey && !event.metaKey && key === 'v') {
      event.preventDefault();
      pasteAtCenter();
    } else if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key === 'Home') {
      event.preventDefault();
      controller.fitBoard(viewport());
    } else if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.code === 'Space') {
      event.preventDefault();
      setSpacePressed(true);
    } else if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      controller.deleteSelected();
    }
  };
  const onKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.code === 'Space') setSpacePressed(false);
  };
  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!interactionEnabled || !document) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement = placementAt({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    if (placement) controller.importDroppedFiles(Array.from(event.dataTransfer.files), placement);
  };

  return <div className="app-shell">
    <TitleBar
      alwaysOnTop={controller.alwaysOnTop}
      pinDisabled={!controller.runtimeStatusReady || controller.isClosing}
      onTogglePin={() => controller.setPinned(!controller.alwaysOnTop)}
      onOpenLibrary={controller.openLibraryFolder}
      onMinimize={() => { void window.referenzio.minimizeWindow(); }}
      onClose={() => { void window.referenzio.closeWindow(); }}
    />
    <div className="board-controls" aria-label="Selected item controls">
      <button type="button" disabled={!controller.selectedItemId} onClick={() => controller.reorderSelected('backward')}>Send backward</button>
      <button type="button" disabled={!controller.selectedItemId} onClick={() => controller.reorderSelected('forward')}>Bring forward</button>
      <button type="button" disabled={!controller.selectedItemId} onClick={() => controller.reorderSelected('back')}>Send to back</button>
      <button type="button" disabled={!controller.selectedItemId} onClick={() => controller.reorderSelected('front')}>Bring to front</button>
      <button type="button" disabled={!controller.selectedItemId} onClick={controller.deleteSelected}>Delete selected</button>
      <button type="button" disabled={!ready || controller.isClosing} onClick={() => controller.fitBoard(viewport())}>Fit board</button>
    </div>
    <NoticeCenter
      hasDocument={document !== null}
      loadState={controller.loadState}
      saveState={controller.saveState}
      isClosing={controller.isClosing}
      importProgress={controller.importProgress}
      recoveryVisible={recoveryVisible && controller.loadState === 'recovered'}
      shortcutMessage={shortcutVisible ? controller.shortcutStatus.message : null}
      errors={controller.errors}
      onRetrySave={controller.retrySave}
      onErrorAction={controller.runErrorAction}
      onDismissRecovery={() => setRecoveryVisible(false)}
      onDismissShortcut={() => setShortcutVisible(false)}
    />
    <div
      id="canvas-host"
      data-testid="canvas-host"
      ref={hostRef}
      tabIndex={0}
      onPointerDownCapture={() => hostRef.current?.focus()}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      {document ? <BoardCanvas
        document={document}
        selectedItemId={controller.selectedItemId}
        missingAssetIds={new Set(controller.missingAssetIds)}
        onSelect={controller.selectItem}
        onClearSelection={controller.clearSelection}
        onPan={controller.panCamera}
        onZoomAt={controller.zoomCameraAt}
        onMove={controller.moveItem}
        onResize={controller.resizeItem}
        spacePressed={spacePressed}
        interactionEnabled={interactionEnabled}
      /> : null}
      {ready && document.items.length === 0 ? <p className="empty-board">Paste with Ctrl+V or drop images. Space-drag to pan; Home fits the board.</p> : null}
    </div>
  </div>;
}
