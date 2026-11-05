import { paintedRegion } from './fill'
import { contains, EMPTY, key, MAX_ROW, pointFromKey, validPoint, WIDTH, type Cell, type Point, type Rect } from './model'

export function connectedShape(cells: ReadonlyMap<string, Cell>, start: Point, width = WIDTH): ReadonlyMap<string, Cell> {
  return paintedRegion(cells, start, false, width)
}

function clampOffset(bounds: Rect, offset: Point, width: number): Point {
  if (!Number.isSafeInteger(offset.x) || !Number.isSafeInteger(offset.y)) {
    throw new Error('Move offsets must be safe integers.')
  }
  return {
    x: Math.min(width - 1 - bounds.right, Math.max(-bounds.left, offset.x)),
    y: Math.min(MAX_ROW - bounds.bottom, Math.max(-bounds.top, offset.y)),
  }
}

export function moveSelection(cells: ReadonlyMap<string, Cell>, bounds: Rect, offset: Point, width = WIDTH): {
  cells: ReadonlyMap<string, Cell>; selection: Rect
} {
  if (!validPoint({ x: bounds.left, y: bounds.top }, width) ||
      !validPoint({ x: bounds.right, y: bounds.bottom }, width) ||
      bounds.bottom > MAX_ROW || bounds.left > bounds.right || bounds.top > bounds.bottom) {
    throw new Error('Move selection coordinates must be within safe document coordinates.')
  }
  const delta = clampOffset(bounds, offset, width)
  const selection = {
    left: bounds.left + delta.x, right: bounds.right + delta.x,
    top: bounds.top + delta.y, bottom: bounds.bottom + delta.y,
  }
  const result = new Map<string, Cell>()
  const translated = new Map<string, Cell>()
  for (const [id, cell] of cells) {
    const point = pointFromKey(id)
    if (contains(bounds, point) || contains(selection, point)) {
      if (!validPoint(point, width) || point.y > MAX_ROW) throw new Error('Move coordinates must be within safe document coordinates.')
      result.set(id, EMPTY)
    }
    if (contains(bounds, point)) translated.set(key(point.x + delta.x, point.y + delta.y), { ...cell })
  }
  for (const [id, cell] of translated) result.set(id, cell)
  return { cells: result, selection }
}

export function moveShape(region: ReadonlyMap<string, Cell>, offset: Point, width = WIDTH): ReadonlyMap<string, Cell> {
  let left = width - 1, right = 0, top = MAX_ROW, bottom = 0
  for (const id of region.keys()) {
    const point = pointFromKey(id)
    if (!validPoint(point, width) || point.y > MAX_ROW) throw new Error('Move coordinates must be within safe document coordinates.')
    left = Math.min(left, point.x); right = Math.max(right, point.x)
    top = Math.min(top, point.y); bottom = Math.max(bottom, point.y)
  }
  const delta = clampOffset({ left, right, top, bottom }, offset, width)
  const result = new Map<string, Cell>()
  for (const id of region.keys()) result.set(id, EMPTY)
  for (const [id, cell] of region) {
    const point = pointFromKey(id)
    result.set(key(point.x + delta.x, point.y + delta.y), { ...cell })
  }
  return result
}
