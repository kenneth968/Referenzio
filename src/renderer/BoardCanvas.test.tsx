import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardDocument } from '../shared/contracts';

type MockNode = { id: () => string; x: () => number; y: () => number; width: () => number; scaleX: () => number; scaleY: () => number; scale: (value: { x: number; y: number }) => void; setGeometry: (value: Partial<{ x: number; y: number; width: number; scaleX: number; scaleY: number }>) => void };
const nodeRefs = new Map<string, MockNode>();
let transformerProps: Record<string, unknown> | undefined;

vi.mock('react-konva', () => {
  const Box = ({ children, scaleX, scaleY, x, y }: Record<string, unknown>) => <div data-camera-x={x as string} data-camera-y={y as string} data-camera-scale-x={scaleX as string} data-camera-scale-y={scaleY as string}>{children as React.ReactNode}</div>;
  const Stage = forwardRef(({ children, onWheel, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: Record<string, unknown>, ref) => {
    const pointer = useRef<{ x: number; y: number } | null>(null);
    useImperativeHandle(ref, () => ({
      getPointerPosition: () => pointer.current,
      container: () => window.document.createElement('div'),
    }));
    const event = (nativeEvent: Event) => ({ evt: nativeEvent, target: { getStage: () => ({ getPointerPosition: () => pointer.current }) } });
    const update = (nativeEvent: MouseEvent | PointerEvent | WheelEvent) => { pointer.current = { x: nativeEvent.clientX, y: nativeEvent.clientY }; };
    return <div data-testid="konva-stage"
      onWheel={(e: React.WheelEvent) => { update(e.nativeEvent); (onWheel as ((event: unknown) => void) | undefined)?.(event(e.nativeEvent)); }}
      onPointerDown={(e: React.PointerEvent) => { update(e.nativeEvent); (onPointerDown as ((event: unknown) => void) | undefined)?.(event(e.nativeEvent)); }}
      onPointerMove={(e: React.PointerEvent) => { update(e.nativeEvent); (onPointerMove as ((event: unknown) => void) | undefined)?.(event(e.nativeEvent)); }}
      onPointerUp={(e: React.PointerEvent) => { update(e.nativeEvent); (onPointerUp as ((event: unknown) => void) | undefined)?.(event(e.nativeEvent)); }}
      onPointerCancel={(e: React.PointerEvent) => { update(e.nativeEvent); (onPointerCancel as ((event: unknown) => void) | undefined)?.(event(e.nativeEvent)); }}
    >{children as React.ReactNode}</div>;
  });
  const Image = forwardRef(({ id, children, onClick, onPointerDown, onDragEnd, onTransformEnd, ...props }: Record<string, unknown>, ref) => {
    const geometry = { x: Number(props.x ?? 0), y: Number(props.y ?? 0), width: Number(props.width ?? 0), scaleX: 1, scaleY: 1 };
    const node: MockNode = { id: () => String(id), x: () => geometry.x, y: () => geometry.y, width: () => geometry.width, scaleX: () => geometry.scaleX, scaleY: () => geometry.scaleY, scale: (value: { x: number; y: number }) => { geometry.scaleX = value.x; geometry.scaleY = value.y; }, setGeometry: (value) => Object.assign(geometry, value) };
    if (id) nodeRefs.set(String(id), node);
    useImperativeHandle(ref, () => node);
    return <button data-testid={`image-${String(id)}`}
      onPointerDown={(e: React.PointerEvent) => (onPointerDown as ((event: unknown) => void) | undefined)?.({ evt: e.nativeEvent, cancelBubble: false, target: node })}
      onClick={(e: React.MouseEvent) => (onClick as ((event: unknown) => void) | undefined)?.({ evt: e.nativeEvent, cancelBubble: false, target: node })}
      onDragEnd={(e: React.DragEvent) => (onDragEnd as ((event: unknown) => void) | undefined)?.({ evt: e.nativeEvent, target: node })}
      onMouseUp={(e: React.MouseEvent) => (onTransformEnd as ((event: unknown) => void) | undefined)?.({ evt: e.nativeEvent, target: node })}
    >{children as React.ReactNode}</button>;
  });
  const Transformer = forwardRef((props: Record<string, unknown>, ref) => { transformerProps = props; useImperativeHandle(ref, () => ({ nodes: vi.fn(), getLayer: () => ({ batchDraw: vi.fn() }) })); return <div data-testid="transformer" />; });
  return { Stage, Layer: Box, Group: Box, Rect: Box, Text: ({ text }: { text: string }) => <span>{text}</span>, Image, Transformer };
});

vi.mock('./konva-image', () => ({ acquireCanvasImage: vi.fn(() => Promise.resolve({})), releaseCanvasImage: vi.fn(), resetCanvasImageCache: vi.fn() }));

import { BoardCanvas } from './BoardCanvas';
import { acquireCanvasImage, resetCanvasImageCache } from './konva-image';

const assetId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const boardDocument: BoardDocument = {
  schemaVersion: 1, revision: 0, camera: { x: 10, y: 20, scale: 1 },
  assets: [{ id: assetId, filename: `${assetId}.png`, mediaType: 'image/png', pixelWidth: 200, pixelHeight: 100, byteSize: 1, importedAt: '2026-01-01T00:00:00.000Z' }],
  items: [{ id: itemId, assetId, x: 30, y: 40, width: 100, height: 50, zIndex: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
};

function props(overrides: Partial<React.ComponentProps<typeof BoardCanvas>> = {}) {
  return { document: boardDocument, selectedItemId: null, missingAssetIds: new Set<string>(), onSelect: vi.fn(), onClearSelection: vi.fn(), onPan: vi.fn(), onZoomAt: vi.fn(), onMove: vi.fn(), onResize: vi.fn(), spacePressed: false, interactionEnabled: true, ...overrides };
}

describe('BoardCanvas', () => {
  beforeEach(() => {
    nodeRefs.clear(); transformerProps = undefined; vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  });
  afterEach(() => { cleanup(); resetCanvasImageCache(); vi.unstubAllGlobals(); });

  it('keeps the pointer world coordinate fixed on wheel zoom', () => {
    const value = props(); render(<BoardCanvas {...value} />);
    fireEvent.wheel(screen.getByTestId('konva-stage'), { clientX: 110, clientY: 220, deltaY: -1 });
    expect(value.onZoomAt).toHaveBeenCalledWith({ x: 110, y: 220 }, 1.1);
  });

  it('ignores zero wheel delta and clamps requested scale', () => {
    const value = props({ document: { ...boardDocument, camera: { x: 0, y: 0, scale: 4 } } }); render(<BoardCanvas {...value} />);
    fireEvent.wheel(screen.getByTestId('konva-stage'), { clientX: 5, clientY: 7, deltaY: -1 });
    fireEvent.wheel(screen.getByTestId('konva-stage'), { clientX: 5, clientY: 7, deltaY: 0 });
    expect(value.onZoomAt).toHaveBeenCalledTimes(1);
    expect(value.onZoomAt).toHaveBeenCalledWith({ x: 5, y: 7 }, 4);
  });

  it('renders a visible missing-asset placeholder instead of an image request', () => {
    const value = props({ missingAssetIds: new Set([assetId]) }); render(<BoardCanvas {...value} />);
    expect(screen.getByText(`Missing asset: ${assetId}`)).toBeVisible();
    expect(acquireCanvasImage).not.toHaveBeenCalled();
  });

  it('uses the exact generated asset protocol URL and reports DOM counts', async () => {
    render(<BoardCanvas {...props()} />);
    await act(async () => {});
    expect(acquireCanvasImage).toHaveBeenCalledWith(`referenzio-asset://asset/${encodeURIComponent(`${assetId}.png`)}`);
    expect(screen.getByTestId('board-canvas')).toHaveAttribute('data-item-count', '1');
    expect(screen.getByTestId('board-canvas')).toHaveAttribute('data-missing-asset-count', '0');
  });

  it('selects images and only clears empty clicks that did not pan', async () => {
    const value = props(); render(<BoardCanvas {...value} />); await act(async () => {});
    fireEvent.click(screen.getByTestId(`image-${itemId}`));
    expect(value.onSelect).toHaveBeenCalledWith(itemId);
    fireEvent.pointerDown(screen.getByTestId('konva-stage'), { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(screen.getByTestId('konva-stage'), { clientX: 11, clientY: 11 });
    expect(value.onClearSelection).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(screen.getByTestId('konva-stage'), { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(screen.getByTestId('konva-stage'), { clientX: 20, clientY: 10 });
    fireEvent.pointerUp(screen.getByTestId('konva-stage'), { clientX: 20, clientY: 10 });
    expect(value.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('pans by incremental screen deltas and ends outside the host', () => {
    const value = props(); render(<BoardCanvas {...value} />);
    fireEvent.pointerDown(screen.getByTestId('konva-stage'), { clientX: 10, clientY: 12 });
    fireEvent.pointerMove(screen.getByTestId('konva-stage'), { clientX: 15, clientY: 20 });
    fireEvent.pointerMove(screen.getByTestId('konva-stage'), { clientX: 18, clientY: 21 });
    fireEvent.pointerUp(window, { clientX: 30, clientY: 30 });
    fireEvent.pointerMove(screen.getByTestId('konva-stage'), { clientX: 25, clientY: 30 });
    expect((value.onPan as ReturnType<typeof vi.fn>).mock.calls).toEqual([[{ x: 5, y: 8 }], [{ x: 3, y: 1 }]]);
  });

  it('uses Space pan mode over an image and latches it through release', () => {
    const value = props({ spacePressed: true }); const { rerender } = render(<BoardCanvas {...value} />);
    fireEvent.pointerDown(screen.getByTestId('konva-stage'), { clientX: 0, clientY: 0 });
    rerender(<BoardCanvas {...value} spacePressed={false} />);
    fireEvent.pointerMove(screen.getByTestId('konva-stage'), { clientX: 7, clientY: 9 });
    fireEvent.pointerUp(screen.getByTestId('konva-stage'), { clientX: 7, clientY: 9 });
    expect(value.onPan).toHaveBeenCalledWith({ x: 7, y: 9 });
    expect(value.onSelect).not.toHaveBeenCalled();
  });

  it('cancels a pan on blur and when interaction becomes disabled', () => {
    const value = props(); const { rerender } = render(<BoardCanvas {...value} />);
    fireEvent.pointerDown(screen.getByTestId('konva-stage'), { clientX: 0, clientY: 0 }); fireEvent.blur(window);
    fireEvent.pointerMove(screen.getByTestId('konva-stage'), { clientX: 3, clientY: 3 });
    rerender(<BoardCanvas {...value} interactionEnabled={false} />);
    fireEvent.pointerDown(screen.getByTestId('konva-stage'), { clientX: 5, clientY: 5 }); fireEvent.pointerMove(screen.getByTestId('konva-stage'), { clientX: 7, clientY: 7 });
    expect(value.onPan).not.toHaveBeenCalled();
  });

  it('moves on drag end and configures a non-rotating four-handle transformer', async () => {
    const value = props({ selectedItemId: itemId }); render(<BoardCanvas {...value} />); await act(async () => {});
    fireEvent.dragEnd(screen.getByTestId(`image-${itemId}`));
    expect(value.onMove).toHaveBeenCalledWith(itemId, { x: 30, y: 40 });
    expect(transformerProps).toMatchObject({ enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], rotateEnabled: false, keepRatio: true, flipEnabled: false });
  });

  it('emits one normalized resize with position and scaled width', async () => {
    const value = props({ selectedItemId: itemId }); render(<BoardCanvas {...value} />); await act(async () => {});
    nodeRefs.get(itemId)?.setGeometry({ x: 18, y: 24, width: 100, scaleX: 0.5, scaleY: 0.5 });
    fireEvent.mouseUp(screen.getByTestId(`image-${itemId}`));
    expect(value.onResize).toHaveBeenCalledWith(itemId, { x: 18, y: 24, width: 50 });
    expect(nodeRefs.get(itemId)?.scaleX()).toBe(1);
    expect(nodeRefs.get(itemId)?.scaleY()).toBe(1);
  });

  it('rejects only widths below the 24-world-unit minimum at both scale limits', () => {
    const value = props({ selectedItemId: itemId, document: { ...boardDocument, camera: { x: 0, y: 0, scale: 0.1 } } });
    const { rerender } = render(<BoardCanvas {...value} />);
    const bound = transformerProps?.boundBoxFunc as ((oldBox: { width: number }, newBox: { width: number }) => { width: number });
    expect(bound({ width: 9 }, { width: 2.39 })).toEqual({ width: 9 });
    expect(bound({ width: 9 }, { width: 2.4 })).toEqual({ width: 2.4 });
    rerender(<BoardCanvas {...value} document={{ ...boardDocument, camera: { x: 0, y: 0, scale: 4 } }} />);
    const largeScaleBound = transformerProps?.boundBoxFunc as ((oldBox: { width: number }, newBox: { width: number }) => { width: number });
    expect(largeScaleBound({ width: 97 }, { width: 95.9 })).toEqual({ width: 97 });
    expect(largeScaleBound({ width: 97 }, { width: 96 })).toEqual({ width: 96 });
  });

  it('replaces a decode failure with a selectable placeholder', async () => {
    vi.mocked(acquireCanvasImage).mockRejectedValueOnce(new Error('decode failed'));
    render(<BoardCanvas {...props()} />);
    await act(async () => {});
    expect(screen.getByText(`Missing asset: ${assetId}`)).toBeVisible();
  });

  it('applies matching camera transforms to both sibling layers', () => {
    render(<BoardCanvas {...props()} />);
    const layers = screen.getByTestId('konva-stage').querySelectorAll('div');
    expect([...layers].filter((layer) => layer.getAttribute('data-camera-x') === '10')).toHaveLength(2);
    expect([...layers].filter((layer) => layer.getAttribute('data-camera-scale-x') === '1')).toHaveLength(2);
  });
});
