import { BLOCK_GLYPHS, flipCharacter } from './ansi'
import { EMPTY, key, MAX_ROW, pointFromKey, validPoint, WIDTH, type Cell, type Point } from './model'

export type PrimitiveKind = 'rectangle' | 'ellipse' | 'rounded-rectangle' | 'star'

function blockColorAt(cell: Cell, x: number, y: number): number | undefined {
  if (cell.code === 32 || cell.code === 255) return cell.bg
  if (cell.fg === cell.bg) return cell.fg
  const block = BLOCK_GLYPHS.get(cell.code)
  if (!block) return undefined
  const [left, top, width, height] = block
  return x >= left && x < left + width && y >= top && y < top + height ? cell.fg : cell.bg
}

export function subtractPrimitive(cells: ReadonlyMap<string, Cell>, mask: ReadonlyMap<string, Cell>, width = WIDTH): ReadonlyMap<string, Cell> {
  const edits = new Map<string, Cell>()
  for (const [id, cut] of mask) {
    const point = pointFromKey(id)
    if (!validPoint(point, width) || point.y > MAX_ROW) throw new Error('Subtraction coordinates must be within safe document coordinates.')
    if (!BLOCK_GLYPHS.has(cut.code)) throw new Error('Subtraction requires full or half block masks.')
    const original = cells.get(id)
    if (!original) continue
    if (cut.code === 219) { edits.set(id, EMPTY); continue }
    const code = flipCharacter(cut.code, cut.code === 221 || cut.code === 222 ? 'x' : 'y')
    const remaining = BLOCK_GLYPHS.get(code)
    if (!remaining) throw new Error('Subtraction requires a representable opposite half block.')
    const [left, top, halfWidth] = remaining
    const colors = halfWidth === 1
      ? [blockColorAt(original, 0.25, top + 0.25), blockColorAt(original, 0.75, top + 0.25)]
      : [blockColorAt(original, left + 0.25, 0.25), blockColorAt(original, left + 0.25, 0.75)]
    const color = colors[0]
    // CP437 cannot retain quarter blocks or partially clipped text/shading.
    edits.set(id, color !== undefined && color !== 0 && color === colors[1] ? { code, fg: color, bg: EMPTY.bg } : EMPTY)
  }
  return edits
}

function boxDistance(x: number, y: number, rx: number, ry: number, radius: number): number {
  const dx = Math.abs(x) - rx + radius, dy = Math.abs(y) - ry + radius
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius
}

function blocksTouch(a: number, b: number, dx: number, dy: number): boolean {
  const first = BLOCK_GLYPHS.get(a), second = BLOCK_GLYPHS.get(b)
  if (!first || !second) throw new Error('Primitive edges require full or half block glyphs.')
  const [ax, ay, aw, ah] = first, [bx, by, bw, bh] = second
  return ax + aw >= dx + bx && ax <= dx + bx + bw && ay + ah >= dy + by && ay <= dy + by + bh
}

export function rasterizePrimitive(
  kind: PrimitiveKind, filled: boolean, start: Point, end: Point, angle: number, ink: Pick<Cell, 'fg' | 'bg'>, width = WIDTH,
): ReadonlyMap<string, Cell> {
  if (!validPoint(start, width) || !validPoint(end, width) || start.y > MAX_ROW || end.y > MAX_ROW || !Number.isFinite(angle)) {
    throw new Error('Primitive coordinates must be within safe document coordinates.')
  }
  const origin = Math.min(start.y, end.y)
  const singleCell = start.x === end.x && start.y === end.y
  const rx = (Math.abs(end.x - start.x) + 1) / 2, ry = Math.abs(end.y - start.y) + 1
  const cx = Math.min(start.x, end.x) + rx, cy = ry
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const extentX = Math.abs(cos) * rx + Math.abs(sin) * ry
  const extentY = Math.abs(sin) * rx + Math.abs(cos) * ry
  const firstRow = Math.floor((cy - extentY) / 2 + 1e-9)
  const lastRow = Math.ceil((cy + extentY) / 2 - 1e-9) - 1
  if (!Number.isSafeInteger(origin + lastRow) || origin + lastRow > MAX_ROW) {
    throw new Error('The rotated primitive exceeds safe document coordinates.')
  }
  const vertices = Array.from({ length: 10 }, (_, index) => {
    const theta = -Math.PI / 2 + index * Math.PI / 5
    const radius = index % 2 ? 0.45 : 1
    return { x: Math.cos(theta) * rx * radius, y: Math.sin(theta) * ry * radius }
  })
  const distance = (x: number, y: number): number => {
    if (kind === 'rectangle') return boxDistance(x, y, rx, ry, 0)
    if (kind === 'rounded-rectangle') return boxDistance(x, y, rx, ry, Math.min(rx, ry) * 0.4)
    if (kind === 'ellipse') {
      const k0 = Math.hypot(x / rx, y / ry)
      const k1 = Math.hypot(x / (rx * rx), y / (ry * ry))
      return k1 === 0 ? -Math.min(rx, ry) : k0 * (k0 - 1) / k1
    }
    let inside = false, nearest = Infinity
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const a = vertices[i], b = vertices[j]
      const dx = b.x - a.x, dy = b.y - a.y
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)))
      nearest = Math.min(nearest, Math.hypot(x - a.x - t * dx, y - a.y - t * dy))
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside
    }
    return inside ? -nearest : nearest
  }
  const cells = new Map<string, Cell>()
  for (let row = Math.max(firstRow, -origin); row <= lastRow; row++) {
    for (let x = Math.max(0, Math.floor(cx - extentX)); x < Math.min(width, Math.ceil(cx + extentX)); x++) {
      const coverage: number[] = []
      // Square subcell samples respect the 1:2 VGA character aspect ratio.
      for (let sy = 0; sy < 8; sy++) for (let sx = 0; sx < 4; sx++) {
        const dx = x + (sx + 0.5) / 4 - cx, dy = row * 2 + (sy + 0.5) / 4 - cy
        const d = distance(dx * cos + dy * sin, -dx * sin + dy * cos)
        coverage.push(filled ? d : Math.max(d, -1 - d))
      }
      if (!coverage.some(d => d <= 0)) continue
      let code = 32, error = singleCell ? Infinity : coverage.reduce((sum, d) => sum + Math.max(0, -d), 0)
      for (const [candidate, [left, top, width, height]] of BLOCK_GLYPHS) {
        let mismatch = 0
        for (let i = 0; i < coverage.length; i++) {
          const sx = (i % 4 + 0.5) / 4, sy = (Math.floor(i / 4) + 0.5) / 8
          const painted = sx >= left && sx < left + width && sy >= top && sy < top + height
          // Mistakes far from the edge cost more than near-edge rounding.
          if (painted !== (coverage[i] <= 0)) mismatch += Math.abs(coverage[i])
        }
        if (mismatch < error - 1e-9 || (!filled && code === 32 && mismatch <= error + 1e-9)) {
          code = candidate; error = mismatch
        }
      }
      if (code !== 32) cells.set(key(x, origin + row), { code, fg: ink.fg, bg: ink.bg })
    }
  }
  // Independent half-block fits can separate an otherwise continuous edge.
  for (const [id, cell] of cells) {
    const { x, y } = pointFromKey(id)
    for (const [dx, dy] of [[1, 0], [-1, 1], [0, 1], [1, 1]]) {
      if (dx && dy && (cells.has(key(x + dx, y)) || cells.has(key(x, y + dy)))) continue
      const neighbor = cells.get(key(x + dx, y + dy))
      if (!neighbor || blocksTouch(cell.code, neighbor.code, dx, dy)) continue
      if (blocksTouch(219, neighbor.code, dx, dy)) cell.code = 219
      else if (blocksTouch(cell.code, 219, dx, dy)) neighbor.code = 219
      else { cell.code = 219; neighbor.code = 219 }
    }
  }
  return cells
}
