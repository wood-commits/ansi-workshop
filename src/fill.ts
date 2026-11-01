import { BLOCK_GLYPHS, flipCharacter } from './ansi'
import { validColor, type DocumentFormat } from './colors'
import { EMPTY, key, MAX_ROW, pointFromKey, validPoint, WIDTH, type Cell, type Point, type Rect } from './model'

export type FillMode = 'shape' | 'enclosed'

function validatePoint(point: Point, width: number): void {
  if (!validPoint(point, width) || point.y > MAX_ROW) throw new Error('Fill coordinates must be within safe document coordinates.')
}

function isShapeBlock(code: number): boolean {
  return BLOCK_GLYPHS.has(code) || (code >= 176 && code <= 178)
}

export function paintedRegion(cells: ReadonlyMap<string, Cell>, start: Point, matching = true, width = WIDTH): ReadonlyMap<string, Cell> {
  validatePoint(start, width)
  const seed = cells.get(key(start.x, start.y))
  if (!seed) throw new Error('Start on an existing painted cell.')
  const shape = isShapeBlock(seed.code)
  const region = new Map<string, Cell>()
  const queue = [start]
  const seen = new Set<string>()
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i], id = key(point.x, point.y)
    if (seen.has(id)) continue
    seen.add(id)
    const cell = cells.get(id)
    if (!cell || (matching && (cell.fg !== seed.fg || cell.bg !== seed.bg ||
        (cell.code !== seed.code && !(shape && isShapeBlock(cell.code)))))) continue
    validatePoint(point, width)
    region.set(id, { ...cell })
    for (const neighbor of [
      { x: point.x - 1, y: point.y }, { x: point.x + 1, y: point.y },
      { x: point.x, y: point.y - 1 }, { x: point.x, y: point.y + 1 },
    ]) {
      if (validPoint(neighbor, width)) queue.push(neighbor)
    }
  }
  return region
}

function blankArea(cell: Cell | undefined): Rect | undefined {
  if (!cell) return { left: 0, top: 0, right: 1, bottom: 1 }
  if (cell.bg !== EMPTY.bg || cell.code === 219) return undefined
  const block = BLOCK_GLYPHS.get(flipCharacter(cell.code, cell.code === 221 || cell.code === 222 ? 'x' : 'y'))
  if (!block) return undefined
  const [left, top, width, height] = block
  return { left, top, right: left + width, bottom: top + height }
}

export function enclosedBlankRegion(cells: ReadonlyMap<string, Cell>, start: Point, width: number): ReadonlySet<string> {
  validatePoint(start, width)
  if (cells.has(key(start.x, start.y))) throw new Error('Click a default blank cell inside a closed outline, or choose Recolor shape.')
  const rows = new Set<number>()
  for (const id of cells.keys()) rows.add(pointFromKey(id).y)
  const queue = [start], seen = new Set([key(start.x, start.y)])
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i], id = key(point.x, point.y)
    validatePoint(point, width)
    const area = blankArea(cells.get(id))
    if (!area) throw new Error('Fill traversal reached a nonblank cell.')
    // A row with no art is open across the document, regardless of distant rows.
    if (!rows.has(point.y) || (point.y === 0 && area.top === 0) ||
        (point.x === 0 && area.left === 0) || (point.x === width - 1 && area.right === 1)) {
      throw new Error('The blank area is not enclosed. Close the outline before filling.')
    }
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if ((dx === -1 && area.left !== 0) || (dx === 1 && area.right !== 1) ||
          (dy === -1 && area.top !== 0) || (dy === 1 && area.bottom !== 1)) continue
      const neighbor = { x: point.x + dx, y: point.y + dy }, neighborId = key(neighbor.x, neighbor.y)
      if (seen.has(neighborId)) continue
      validatePoint(neighbor, width)
      const other = blankArea(cells.get(neighborId))
      if (!other) continue
      const connected = dx !== 0
        ? (dx === -1 ? other.right === 1 : other.left === 0) &&
          Math.max(area.top, other.top) < Math.min(area.bottom, other.bottom)
        : (dy === -1 ? other.bottom === 1 : other.top === 0) &&
          Math.max(area.left, other.left) < Math.min(area.right, other.right)
      if (connected) { seen.add(neighborId); queue.push(neighbor) }
    }
  }
  return seen
}

export function filledBlank(cell: Cell | undefined, fg: number, format: DocumentFormat): Cell {
  if (!cell || cell.fg === fg) return { code: 219, fg, bg: EMPTY.bg }
  if (validColor(fg, true, format)) return { ...cell, bg: fg }
  if (validColor(cell.fg, true, format)) {
    return { code: flipCharacter(cell.code, cell.code === 221 || cell.code === 222 ? 'x' : 'y'), fg, bg: cell.fg }
  }
  throw new Error('Classic ANSI cannot retain two bright colors in one half-block cell. Choose a nonbright fill color or use an iCE document.')
}

export function bucketFill(cells: ReadonlyMap<string, Cell>, start: Point, mode: FillMode, fg: number, format: DocumentFormat = 'ansi', width = WIDTH): ReadonlyMap<string, Cell> {
  validatePoint(start, width)
  if (!validColor(fg, false, format)) throw new Error('Fill requires a valid document foreground color.')
  const result = new Map<string, Cell>()
  if (mode === 'shape') {
    for (const [id, cell] of paintedRegion(cells, start, true, width)) {
      result.set(id, { ...cell, code: cell.code >= 176 && cell.code <= 178 ? 219 : cell.code, fg })
    }
  } else {
    const region = enclosedBlankRegion(cells, start, width)
    for (const id of region) result.set(id, filledBlank(cells.get(id), fg, format))
  }
  return result
}
