import { paintedRegion } from './fill'
import { EMPTY, key, MAX_ROW, pointFromKey, validPoint, WIDTH, type Cell, type Point } from './model'

export function connectedShape(cells: ReadonlyMap<string, Cell>, start: Point): ReadonlyMap<string, Cell> {
  return paintedRegion(cells, start, false)
}

export function moveShape(region: ReadonlyMap<string, Cell>, offset: Point): ReadonlyMap<string, Cell> {
  if (!Number.isSafeInteger(offset.x) || !Number.isSafeInteger(offset.y)) {
    throw new Error('Move offsets must be safe integers.')
  }
  let left = WIDTH - 1, right = 0, top = MAX_ROW, bottom = 0
  for (const id of region.keys()) {
    const point = pointFromKey(id)
    if (!validPoint(point) || point.y > MAX_ROW) throw new Error('Move coordinates must be within safe document coordinates.')
    left = Math.min(left, point.x); right = Math.max(right, point.x)
    top = Math.min(top, point.y); bottom = Math.max(bottom, point.y)
  }
  const dx = Math.min(WIDTH - 1 - right, Math.max(-left, offset.x))
  const dy = Math.min(MAX_ROW - bottom, Math.max(-top, offset.y))
  const result = new Map<string, Cell>()
  for (const id of region.keys()) result.set(id, EMPTY)
  for (const [id, cell] of region) {
    const point = pointFromKey(id)
    result.set(key(point.x + dx, point.y + dy), { ...cell })
  }
  return result
}
