import { BLOCK_GLYPHS } from './ansi'
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

function enclosedBlankSpans(cells: ReadonlyMap<string, Cell>, start: Point, width: number): Rect[] {
  if (cells.has(key(start.x, start.y))) throw new Error('Click a default blank cell inside a closed outline, or choose Recolor shape.')
  const rows = new Map<number, Set<number>>()
  for (const id of cells.keys()) {
    const { x, y } = pointFromKey(id)
    let row = rows.get(y)
    if (!row) { row = new Set(); rows.set(y, row) }
    row.add(x)
  }
  const spans: Rect[] = [], queue = [start], seen = new Set<string>()
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i], id = key(point.x, point.y)
    if (seen.has(id) || cells.has(id)) continue
    validatePoint(point, width)
    const row = rows.get(point.y)
    // A row with no art is open across the document, regardless of distant rows.
    if (!row || point.y === 0) throw new Error('The blank area is not enclosed. Close the outline before filling.')
    let left = point.x, right = point.x
    while (left > 0 && !row.has(left - 1)) left--
    while (right < width - 1 && !row.has(right + 1)) right++
    if (left === 0 || right === width - 1) throw new Error('The blank area is not enclosed. Close the outline before filling.')
    spans.push({ left, right, top: point.y, bottom: point.y })
    for (let x = left; x <= right; x++) seen.add(key(x, point.y))
    for (let x = left; x <= right; x++) queue.push({ x, y: point.y - 1 }, { x, y: point.y + 1 })
  }
  return spans
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
    const spans = enclosedBlankSpans(cells, start, width)
    for (const span of spans) for (let x = span.left; x <= span.right; x++) {
      result.set(key(x, span.top), { code: 219, fg, bg: EMPTY.bg })
    }
  }
  return result
}
