import { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { Box } from 'konva/lib/shapes/Transformer';
import { MAX_SCALE, MIN_SCALE, type BoardDocument, type BoardItem, type Point } from '../shared/contracts';
import { acquireCanvasImage, releaseCanvasImage } from './konva-image';

const MIN_ITEM_WIDTH = 24;
const CLICK_THRESHOLD = 3;

export type BoardCanvasProps = {
  document: BoardDocument;
  selectedItemId: string | null;
  missingAssetIds: ReadonlySet<string>;
  onSelect: (itemId: string) => void;
  onClearSelection: () => void;
  onPan: (delta: Point) => void;
  onZoomAt: (pointer: Point, scale: number) => void;
  onMove: (itemId: string, point: Point) => void;
  onResize: (itemId: string, transform: { x: number; y: number; width: number }) => void;
  spacePressed: boolean;
  interactionEnabled: boolean;
};

type Gesture = { mode: 'pan'; origin: Point; last: Point; moved: boolean } | { mode: 'item'; itemId: string; origin: Point; last: Point; moved: boolean } | null;
type ItemNode = Konva.Image | Konva.Group;

function useCanvasImage(source: string | null): { image: HTMLImageElement | null; failed: boolean } {
  const [state, setState] = useState<{ source: string | null; image: HTMLImageElement | null; failed: boolean }>({ source: null, image: null, failed: false });
  useEffect(() => {
    if (!source) { setState({ source: null, image: null, failed: false }); return; }
    let active = true;
    setState({ source, image: null, failed: false });
    void acquireCanvasImage(source).then(
      (image) => { if (active) setState({ source, image, failed: false }); },
      () => { if (active) setState({ source, image: null, failed: true }); },
    );
    return () => { active = false; releaseCanvasImage(source); };
  }, [source]);
  return state.source === source ? { image: state.image, failed: state.failed } : { image: null, failed: false };
}

function assetUrl(filename: string): string {
  return `referenzio-asset://asset/${encodeURIComponent(filename)}`;
}

type CanvasItemProps = {
  item: BoardItem;
  filename: string | undefined;
  missing: boolean;
  cameraScale: number;
  interactionEnabled: boolean;
  panWithSpace: boolean;
  itemRef: (node: ItemNode | null) => void;
  onItemPointerDown: (event: Konva.KonvaEventObject<PointerEvent>) => void;
  onSelect: (event: Konva.KonvaEventObject<MouseEvent>) => void;
  onMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onResize: (event: Konva.KonvaEventObject<Event>) => void;
};

function CanvasItem({ item, filename, missing, cameraScale, interactionEnabled, panWithSpace, itemRef, onItemPointerDown, onSelect, onMove, onResize }: CanvasItemProps) {
  const source = !missing && filename ? assetUrl(filename) : null;
  const { image, failed } = useCanvasImage(source);
  const placeholder = missing || failed || !image;
  const common = {
    id: item.id, x: item.x, y: item.y, width: item.width, height: item.height,
    draggable: interactionEnabled && !panWithSpace,
    onPointerDown: onItemPointerDown,
    onClick: onSelect,
    onDragEnd: onMove,
    onTransformEnd: onResize,
  };
  return <Group {...common} ref={itemRef as never}>
    {placeholder ? <>
      <Rect width={item.width} height={item.height} stroke="#d92d20" strokeWidth={2 / cameraScale} fill="rgba(217,45,32,0.08)" />
      <Text text={`Missing asset: ${item.assetId}`} width={item.width} height={item.height} fill="#d92d20" fontSize={Math.max(12 / cameraScale, 1)} padding={6 / cameraScale} />
    </> : <KonvaImage image={image} width={item.width} height={item.height} />}
  </Group>;
}

export function BoardCanvas({ document, selectedItemId, missingAssetIds, onSelect, onClearSelection, onPan, onZoomAt, onMove, onResize, spacePressed, interactionEnabled }: BoardCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const itemNodes = useRef(new Map<string, ItemNode>());
  const gesture = useRef<Gesture>(null);
  const suppressItemClick = useRef(false);
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const items = useMemo(() => [...document.items].sort((left, right) => left.zIndex - right.zIndex), [document.items]);
  const assetById = useMemo(() => new Map(document.assets.map((asset) => [asset.id, asset])), [document.assets]);

  const stopGesture = (cancelled: boolean) => {
    const active = gesture.current;
    gesture.current = null;
    if (cancelled && active?.mode === 'item') {
      const item = items.find((candidate) => candidate.id === active.itemId);
      const node = item && itemNodes.current.get(item.id);
      if (item && node) {
        node.position({ x: item.x, y: item.y });
        node.width(item.width);
        node.height(item.height);
        node.scale({ x: 1, y: 1 });
        node.getLayer()?.batchDraw();
      }
    }
    if (active?.mode === 'pan') suppressItemClick.current = active.moved;
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const bounds = host.getBoundingClientRect();
      setViewport({ width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!interactionEnabled) stopGesture(true);
  }, [interactionEnabled]);

  useEffect(() => {
    const cancel = () => stopGesture(true);
    const visibility = () => { if (window.document.visibilityState === 'hidden') cancel(); };
    const outsideUp = () => stopGesture(false);
    window.addEventListener('blur', cancel);
    window.addEventListener('pointerup', outsideUp);
    window.addEventListener('pointercancel', cancel);
    window.document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pointerup', outsideUp);
      window.removeEventListener('pointercancel', cancel);
      window.document.removeEventListener('visibilitychange', visibility);
    };
  });

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const selectedNode = selectedItemId ? itemNodes.current.get(selectedItemId) : undefined;
    transformer.nodes(selectedNode ? [selectedNode] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedItemId, items]);

  const startPan = (point: Point) => { gesture.current = { mode: 'pan', origin: point, last: point, moved: false }; };
  const stagePoint = () => stageRef.current?.getPointerPosition() ?? null;
  const onStagePointerDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    if (!interactionEnabled) return;
    if (event.target !== stageRef.current) return;
    const point = stagePoint();
    if (!point) return;
    if (spacePressed) { event.evt.preventDefault(); startPan(point); return; }
    startPan(point);
  };
  const onItemPointerDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    if (!interactionEnabled) return;
    suppressItemClick.current = false;
    const point = stagePoint();
    if (!point) return;
    event.cancelBubble = true;
    if (spacePressed) { event.evt.preventDefault(); suppressItemClick.current = true; startPan(point); return; }
    gesture.current = { mode: 'item', itemId: event.target.id(), origin: point, last: point, moved: false };
  };
  const onTransformerPointerDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    if (!interactionEnabled) return;
    event.cancelBubble = true;
    const point = stagePoint();
    if (point && selectedItemId) gesture.current = { mode: 'item', itemId: selectedItemId, origin: point, last: point, moved: false };
  };
  const onStagePointerMove = () => {
    const active = gesture.current;
    const point = stagePoint();
    if (!active || !point || active.mode !== 'pan') return;
    const delta = { x: point.x - active.last.x, y: point.y - active.last.y };
    if (delta.x || delta.y) {
      active.moved ||= Math.hypot(point.x - active.origin.x, point.y - active.origin.y) >= CLICK_THRESHOLD;
      active.last = point;
      onPan(delta);
    }
  };
  const onStagePointerUp = () => {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    if (active.mode === 'pan') {
      if (active.moved) suppressItemClick.current = true;
      else onClearSelection();
    }
  };
  const onWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    if (!interactionEnabled || event.evt.deltaY === 0) return;
    const point = stagePoint();
    if (!point) return;
    event.evt.preventDefault();
    const direction = event.evt.deltaY > 0 ? 0.9 : 1.1;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, document.camera.scale * direction));
    onZoomAt(point, scale);
  };
  const onItemSelect = (itemId: string) => (event: Konva.KonvaEventObject<MouseEvent>) => {
    event.cancelBubble = true;
    if (!interactionEnabled || suppressItemClick.current) { suppressItemClick.current = false; return; }
    onSelect(itemId);
  };
  const onItemMove = (itemId: string) => (event: Konva.KonvaEventObject<DragEvent>) => {
    if (!interactionEnabled || gesture.current?.mode === 'pan') return;
    const node = event.target;
    onMove(itemId, { x: node.x(), y: node.y() });
    gesture.current = null;
  };
  const onItemResize = (itemId: string) => (event: Konva.KonvaEventObject<Event>) => {
    if (!interactionEnabled || gesture.current?.mode === 'pan') return;
    const node = event.target;
    const x = node.x();
    const y = node.y();
    const width = node.width() * node.scaleX();
    node.scale({ x: 1, y: 1 });
    onResize(itemId, { x, y, width });
    gesture.current = null;
  };
  const boundBoxFunc = (oldBox: Box, newBox: Box): Box => newBox.width / document.camera.scale < MIN_ITEM_WIDTH - 1e-9 ? oldBox : newBox;
  const cursor = !interactionEnabled ? 'default' : gesture.current?.mode === 'pan' ? 'grabbing' : spacePressed ? 'grab' : 'default';

  return <div ref={hostRef} data-testid="board-canvas" data-item-count={items.length} data-missing-asset-count={missingAssetIds.size} style={{ width: '100%', height: '100%', overflow: 'hidden', cursor }}>
    <Stage ref={stageRef} width={viewport.width} height={viewport.height} onPointerDown={onStagePointerDown} onPointerMove={onStagePointerMove} onPointerUp={onStagePointerUp} onPointerCancel={() => stopGesture(true)} onWheel={onWheel}>
      <Layer x={document.camera.x} y={document.camera.y} scaleX={document.camera.scale} scaleY={document.camera.scale}>
        {items.map((item) => <CanvasItem key={item.id} item={item} filename={assetById.get(item.assetId)?.filename} missing={missingAssetIds.has(item.assetId)} cameraScale={document.camera.scale} interactionEnabled={interactionEnabled} panWithSpace={spacePressed} itemRef={(node) => { if (node) itemNodes.current.set(item.id, node); else itemNodes.current.delete(item.id); }} onItemPointerDown={onItemPointerDown} onSelect={onItemSelect(item.id)} onMove={onItemMove(item.id)} onResize={onItemResize(item.id)} />)}
      </Layer>
      <Layer x={document.camera.x} y={document.camera.y} scaleX={document.camera.scale} scaleY={document.camera.scale}>
        <Transformer ref={transformerRef} onPointerDown={onTransformerPointerDown} enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']} rotateEnabled={false} keepRatio flipEnabled={false} boundBoxFunc={boundBoxFunc} />
      </Layer>
    </Stage>
  </div>;
}
