import { BLOCK_GLYPHS } from './ansi'
import { validColor, type DocumentFormat } from './colors'
import { MAX_ROW, WIDTH, pointFromKey, validPoint, type Cell, type Point } from './model'

export { paintedRegion as gradientRegion } from './fill'

export type GradientKind = 'linear' | 'radial'
export interface GradientLine { start: Point; end: Point }

function validatePoint(point: Point, width: number): void {
  if (!validPoint(point, width) || point.y > MAX_ROW) throw new Error('Gradient coordinates must be within safe document coordinates.')
}

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

export function rasterizeGradient(
  region: ReadonlyMap<string, Cell>, kind: GradientKind, start: Point, end: Point, ink: Pick<Cell, 'fg' | 'bg'>, format: DocumentFormat = 'ansi', width = WIDTH,
): ReadonlyMap<string, Cell> {
  validatePoint(start, width); validatePoint(end, width)
  if (!validColor(ink.fg, false, format) || !validColor(ink.bg, true, format)) {
    throw new Error('Gradient colors require valid document foreground and background colors.')
  }
  const cells = new Map<string, Cell>()
  const dx = end.x - start.x, dy = (end.y - start.y) * 2
  const length = Math.hypot(dx, dy)
  if (length === 0) return cells
  for (const [id, cell] of region) {
    const point = pointFromKey(id)
    validatePoint(point, width)
    const x = point.x - start.x, y = (point.y - start.y) * 2
    const t = kind === 'radial' ? Math.hypot(x, y) / length : (x * (dx / length) + y * (dy / length)) / length
    if (BLOCK_GLYPHS.has(cell.code) && cell.code !== 219) {
      // CP437 has no shaded half blocks; retain the edge and its outside color.
      cells.set(id, { ...cell, fg: t < 0.5 ? ink.fg : ink.bg })
      continue
    }
    const coverage = (1 - Math.max(0, Math.min(1, t))) * 4
    const base = Math.floor(coverage)
    const threshold = (BAYER[point.y % 4][point.x % 4] + 0.5) / 16
    const level = Math.min(4, base + Number(coverage - base > threshold))
    // Both endpoints are foreground-colored full blocks, never background-only spaces.
    cells.set(id, { code: level === 0 || level === 4 ? 219 : 175 + level, fg: level === 0 ? ink.bg : ink.fg, bg: ink.bg })
  }
  return cells
}
