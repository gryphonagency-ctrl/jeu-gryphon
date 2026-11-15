export interface SplitViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getSplitViewports(width: number, height: number, count: number): SplitViewport[] {
  const views = Math.min(4, Math.max(1, Math.floor(count)));
  if (views === 1) return [{ x: 0, y: 0, width, height }];

  const portraitTwoPlayer = views === 2 && height > width;
  const columns = views === 2 && !portraitTwoPlayer ? 2 : views === 2 ? 1 : 2;
  const rows = views === 2 && !portraitTwoPlayer ? 1 : views === 2 ? 2 : 2;
  const cellWidth = width / columns;
  const cellHeight = height / rows;

  return Array.from({ length: views }, (_, index) => ({
    x: (index % columns) * cellWidth,
    y: Math.floor(index / columns) * cellHeight,
    width: cellWidth,
    height: cellHeight,
  }));
}
