import { key, linePoints, MAX_ROW, WIDTH, validPoint, type Cell, type Point } from './model'

export interface HalfPoint extends Point { half: 0 | 1 }

export function rasterizeHalfBlockStroke(
  cells: ReadonlyMap<string, Cell>, start: HalfPoint, end: HalfPoint, ink: Pick<Cell, 'fg' | 'bg'>, width = WIDTH,
): ReadonlyMap<string, Cell> {
  for (const point of [start, end]) {
    if (!validPoint(point, width) || point.y > MAX_ROW || (point.half !== 0 && point.half !== 1)) {
      throw new Error('Half-block strokes require safe document coordinates.')
    }
  }
  // Double only local row offsets, never absolute document coordinates.
  const origin = Math.min(start.y, end.y)
  const first = { x: start.x, y: (start.y - origin) * 2 + start.half }
  const last = { x: end.x, y: (end.y - origin) * 2 + end.half }
  if (!Number.isSafeInteger(first.y) || !Number.isSafeInteger(last.y)) {
    throw new Error('The half-block stroke exceeds safe coordinate precision.')
  }
  const edits = new Map<string, Cell>()
  for (const pixel of linePoints(first, last)) {
    const id = key(pixel.x, origin + Math.floor(pixel.y / 2))
    const code = pixel.y % 2 === 0 ? 223 : 220
    const previous = edits.get(id) ?? cells.get(id)
    const merge = previous?.fg === ink.fg && previous.bg === ink.bg &&
      (previous.code === 219 || previous.code === (code === 223 ? 220 : 223))
    edits.set(id, { code: merge ? 219 : code, fg: ink.fg, bg: ink.bg })
  }
  return edits
}
