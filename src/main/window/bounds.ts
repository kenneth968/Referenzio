export type WindowBounds = { x: number; y: number; width: number; height: number };
export type WorkArea = WindowBounds;

const visibleStrip = 64;

function intersects(first: WindowBounds, second: WorkArea): boolean {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function clampBounds(saved: WindowBounds, workAreas: WorkArea[], primaryWorkArea: WorkArea): WindowBounds {
  const display = workAreas.find((workArea) => intersects(saved, workArea));
  const workArea = display ?? primaryWorkArea;
  const width = Math.min(saved.width, workArea.width);
  const height = Math.min(saved.height, workArea.height);

  if (!display) return { x: workArea.x, y: workArea.y, width, height };

  return {
    x: clamp(saved.x, workArea.x - width + visibleStrip, workArea.x + workArea.width - visibleStrip),
    y: clamp(saved.y, workArea.y - height + visibleStrip, workArea.y + workArea.height - visibleStrip),
    width,
    height,
  };
}
