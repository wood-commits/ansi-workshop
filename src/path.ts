import { BLOCK_GLYPHS } from './ansi'
import type { DocumentFormat } from './colors'
import { EMPTY, MAX_ROW, WIDTH, key, pointFromKey, validateCell, validateWidth, validPoint, type Cell, type Point } from './model'
import { glyphMask } from './vgaFont'

export interface PathNode { point: Point; incoming: Point; outgoing: Point; linked?: boolean }
export interface BezierPath { origin: number; nodes: PathNode[]; closed: boolean }

const SAMPLE_WIDTH = 8
const SAMPLE_HEIGHT = 16
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const interpolate = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

function splitSegment(a: PathNode, b: PathNode, t: number) {
  const ab = interpolate(a.point, a.outgoing, t), bc = interpolate(a.outgoing, b.incoming, t)
  const cd = interpolate(b.incoming, b.point, t)
  const incoming = interpolate(ab, bc, t), outgoing = interpolate(bc, cd, t)
  return { ab, cd, node: { point: interpolate(incoming, outgoing, t), incoming, outgoing } }
}

function sampleCurve(a: Point, b: Point, c: Point, d: Point, emit: (point: Point, t: number) => void, depth = 0, start = 0, end = 1): void {
  // Square VGA-pixel proportions, retaining local row precision.
  const deviation = Math.max(
    Math.hypot(b.x - (2 * a.x + d.x) / 3, 2 * (b.y - (2 * a.y + d.y) / 3)),
    Math.hypot(c.x - (a.x + 2 * d.x) / 3, 2 * (c.y - (a.y + 2 * d.y) / 3)),
  )
  if (deviation <= 1 / 32) { emit(d, end); return }
  if (depth === 16) throw new Error('The path is too complex to rasterize. Shorten its curve handles.')
  const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d)
  const abc = midpoint(ab, bc), bcd = midpoint(bc, cd), center = midpoint(abc, bcd)
  const t = (start + end) / 2
  sampleCurve(a, ab, abc, center, emit, depth + 1, start, t)
  sampleCurve(center, bcd, cd, d, emit, depth + 1, t, end)
}

export function hitPathSegment(path: BezierPath, point: Point, tolerance: Point): { index: number; t: number } | undefined {
  if (![point.x, point.y, tolerance.x, tolerance.y].every(Number.isFinite) || tolerance.x <= 0 || tolerance.y <= 0) {
    throw new Error('Path hit testing requires finite coordinates and positive tolerance.')
  }
  let nearest = 1, hit: { index: number; t: number } | undefined
  const count = path.closed ? path.nodes.length : path.nodes.length - 1
  let samples = 0
  for (let index = 0; index < count; index++) {
    const a = path.nodes[index], b = path.nodes[(index + 1) % path.nodes.length]
    const distance = (t: number) => {
      const p = splitSegment(a, b, t).node.point
      return Math.hypot((p.x - point.x) / tolerance.x, (p.y - point.y) / tolerance.y)
    }
    let previous = a.point, previousT = 0, left = 0, right = 1, best = Infinity
    const emit = (p: Point, t: number) => {
      if (++samples > 65_536) throw new Error('The path is too complex to edit. Shorten its curve handles.')
      const dx = (p.x - previous.x) / tolerance.x, dy = (p.y - previous.y) / tolerance.y
      const px = (point.x - previous.x) / tolerance.x, py = (point.y - previous.y) / tolerance.y
      const length = dx * dx + dy * dy
      const fraction = length ? Math.max(0, Math.min(1, (px * dx + py * dy) / length)) : 0
      const value = Math.hypot(px - dx * fraction, py - dy * fraction)
      if (value < best) { best = value; left = previousT; right = t }
      previous = p; previousT = t
    }
    if (a.point.x === a.outgoing.x && a.point.y === a.outgoing.y &&
        b.point.x === b.incoming.x && b.point.y === b.incoming.y) emit(b.point, 1)
    else sampleCurve(a.point, a.outgoing, b.incoming, b.point, emit)
    for (let step = 0; step < 32; step++) {
      const a = left + (right - left) / 3, b = right - (right - left) / 3
      if (distance(a) < distance(b)) right = b
      else left = a
    }
    const t = (left + right) / 2, value = distance(t)
    if (value < nearest) { nearest = value; hit = { index, t } }
  }
  return hit
}

export function insertPathNode(path: BezierPath, index: number, t: number): BezierPath {
  const a = selectedNode(path, index)
  const next = (index + 1) % path.nodes.length
  if ((!path.closed && next === 0) || !Number.isFinite(t) || t <= 0 || t >= 1) {
    throw new Error('Select a location inside an existing path segment.')
  }
  const { ab, cd, node } = splitSegment(a, path.nodes[next], t)
  const nodes = path.nodes.map((value, position) => position === index ? { ...value, outgoing: ab }
    : position === next ? { ...value, incoming: cd } : value)
  nodes.splice(index + 1, 0, node)
  return { ...path, nodes }
}

export function movePathHandle(node: PathNode, part: 'incoming' | 'outgoing', position: Point): PathNode {
  const other = part === 'incoming' ? 'outgoing' : 'incoming'
  if (!node.linked) return { ...node, [part]: position }
  const dx = position.x - node.point.x, dy = position.y - node.point.y
  const length = Math.hypot(dx, 2 * dy)
  const oppositeLength = Math.hypot(node[other].x - node.point.x, 2 * (node[other].y - node.point.y))
  const scale = length ? (oppositeLength || length) / length : 0
  return { ...node, [part]: position, [other]: { x: node.point.x - dx * scale, y: node.point.y - dy * scale } }
}

export function linkPathHandles(path: BezierPath, index: number, linked: boolean): BezierPath {
  let node = { ...selectedNode(path, index), linked }
  if (linked) {
    const part = node.outgoing.x !== node.point.x || node.outgoing.y !== node.point.y ? 'outgoing' : 'incoming'
    node = { ...movePathHandle(node, part, node[part]), linked }
  }
  return { ...path, nodes: path.nodes.map((value, position) => position === index ? node : value) }
}

export function translatePath(path: BezierPath, delta: Point, width = WIDTH): BezierPath {
  validateWidth(width)
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw new Error('Path movement must use finite coordinates.')
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
  for (const { point } of path.nodes) {
    left = Math.min(left, point.x); right = Math.max(right, point.x)
    top = Math.min(top, point.y); bottom = Math.max(bottom, point.y)
  }
  const dx = Math.min(width - right, Math.max(-left, delta.x))
  const dy = Math.min(MAX_ROW - path.origin - bottom, Math.max(-path.origin - top, delta.y))
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy })
  return { ...path, nodes: path.nodes.map(node => ({ ...node, point: shift(node.point), incoming: shift(node.incoming), outgoing: shift(node.outgoing) })) }
}

export function pathContainsPoint(path: BezierPath, point: Point): boolean {
  if (!path.closed || path.nodes.length < 3) return false
  const hits = intersections(flatten(path), point.y)
  return hits.filter(x => x > point.x).length % 2 === 1
}

function selectedNode(path: BezierPath, index: number): PathNode {
  if (!Number.isInteger(index) || index < 0 || index >= path.nodes.length) throw new Error('Select an existing path node.')
  return path.nodes[index]
}

export function removePathNode(path: BezierPath, index: number): BezierPath {
  selectedNode(path, index)
  const nodes = path.nodes.filter((_node, position) => position !== index)
  return { ...path, nodes, closed: path.closed && nodes.length >= 3 }
}

export function convertPathNode(path: BezierPath, index: number, curved: boolean): BezierPath {
  const node = selectedNode(path, index)
  let incoming = node.point, outgoing = node.point
  if (curved) {
    const previous = path.nodes[index - 1] ?? (path.closed ? path.nodes.at(-1) : undefined)
    const next = path.nodes[index + 1] ?? (path.closed ? path.nodes[0] : undefined)
    const a = previous?.point ?? node.point, b = next?.point ?? node.point
    const dx = b.x - a.x, dy = b.y - a.y
    const distance = Math.hypot(dx, dy * 2)
    const lengths = [previous, next].filter(value => value !== undefined)
      .map(value => Math.hypot(value.point.x - node.point.x, 2 * (value.point.y - node.point.y)))
    const length = lengths.length ? Math.min(...lengths) / 3 : 1
    const handle = distance ? { x: dx / distance * length, y: dy / distance * length } : { x: length || 1, y: 0 }
    incoming = { x: node.point.x - handle.x, y: node.point.y - handle.y }
    outgoing = { x: node.point.x + handle.x, y: node.point.y + handle.y }
  }
  return { ...path, nodes: path.nodes.map((value, position) => position === index ? { ...node, incoming, outgoing } : value) }
}

function flatten(path: BezierPath): Point[] {
  if (!path.closed) throw new Error('The path must be closed before filling.')
  if (path.nodes.length < 3) throw new Error('A path needs at least three nodes.')
  if (!Number.isSafeInteger(path.origin) || path.origin < 0 || path.origin > MAX_ROW) {
    throw new Error('Path coordinates must be within safe document coordinates.')
  }
  for (const node of path.nodes) for (const point of [node.point, node.incoming, node.outgoing]) {
    const row = Math.floor(point.y)
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > Number.MAX_SAFE_INTEGER ||
        !Number.isSafeInteger(row) || !Number.isSafeInteger(path.origin + row) ||
        (point === node.point && path.origin + row < 0) || path.origin + row > MAX_ROW) {
      throw new Error('Path coordinates and handles must be within safe document coordinates.')
    }
  }
  const result: Point[] = [path.nodes[0].point]
  const emit = (point: Point) => {
    if (result.length >= 65_536) throw new Error('The path is too complex to rasterize. Shorten its curve handles.')
    result.push(point)
  }
  for (let index = 0; index < path.nodes.length; index++) {
    const a = path.nodes[index], b = path.nodes[(index + 1) % path.nodes.length]
    if (a.point.x === a.outgoing.x && a.point.y === a.outgoing.y &&
        b.point.x === b.incoming.x && b.point.y === b.incoming.y) result.push(b.point)
    else sampleCurve(a.point, a.outgoing, b.incoming, b.point, emit)
  }
  return result
}

function intersections(polygon: Point[], y: number): number[] {
  const hits: number[] = []
  for (let index = 1; index < polygon.length; index++) {
    const a = polygon[index - 1], b = polygon[index]
    if ((a.y > y) !== (b.y > y)) hits.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x))
  }
  return hits.sort((a, b) => a - b)
}

function coverage(lines: number[][], x: number): Uint8Array {
  const mask = new Uint8Array(SAMPLE_WIDTH * SAMPLE_HEIGHT)
  for (let sy = 0; sy < SAMPLE_HEIGHT; sy++) {
    const hits = lines[sy]
    for (let sx = 0; sx < SAMPLE_WIDTH; sx++) {
      const px = x + (sx + 0.5) / SAMPLE_WIDTH
      for (let index = 0; index + 1 < hits.length; index += 2) {
        if (px >= hits[index] && px < hits[index + 1]) { mask[sy * SAMPLE_WIDTH + sx] = 1; break }
      }
    }
  }
  return mask
}

function fitBlock(colors: number[], foregrounds: number[], bg: number): Cell {
  let best: Cell = { ...EMPTY, bg }, error = colors.filter(color => color !== bg).length
  for (const fg of foregrounds) for (const [code, [left, top, width, height]] of BLOCK_GLYPHS) {
    let mismatch = 0
    for (let index = 0; index < colors.length; index++) {
      const x = (index % SAMPLE_WIDTH + 0.5) / SAMPLE_WIDTH
      const y = (Math.floor(index / SAMPLE_WIDTH) + 0.5) / SAMPLE_HEIGHT
      const color = x >= left && x < left + width && y >= top && y < top + height ? fg : bg
      if (color !== colors[index]) mismatch++
    }
    if (mismatch < error) { error = mismatch; best = { code, fg, bg } }
  }
  return best
}

export function rasterizePath(
  path: BezierPath, ink: Pick<Cell, 'fg' | 'bg'>, subtractFrom?: ReadonlyMap<string, Cell>, format: DocumentFormat = 'ansi', width = WIDTH,
): ReadonlyMap<string, Cell> {
  validateCell({ code: 219, ...ink }, format)
  const polygon = flatten(path)
  const edits = new Map<string, Cell>()
  let left = Infinity, right = -Infinity, first = Infinity, last = -Infinity
  for (const point of polygon) {
    left = Math.min(left, point.x); right = Math.max(right, point.x)
    first = Math.min(first, point.y); last = Math.max(last, point.y)
  }
  const linesAt = (row: number) => Array.from({ length: SAMPLE_HEIGHT }, (_, sy) =>
    intersections(polygon, row + (sy + 0.5) / SAMPLE_HEIGHT))
  if (subtractFrom) {
    let cachedRow: number | undefined
    let lines: number[][] = []
    // Subtraction visits stored art only, including huge blank gaps inside a path.
    for (const [id, original] of subtractFrom) {
      const point = pointFromKey(id)
      if (!validPoint(point, width) || point.y > MAX_ROW) throw new Error('Subtraction coordinates must be within safe document coordinates.')
      const row = point.y - path.origin
      if (point.x + 1 <= left || point.x >= right || row + 1 <= first || row >= last) continue
      if (row !== cachedRow) { cachedRow = row; lines = linesAt(row) }
      const mask = coverage(lines, point.x)
      if (!mask.some(Boolean)) continue
      validateCell(original, format)
      const glyph = glyphMask(original.code)
      const block = BLOCK_GLYPHS.get(original.code)
      const colors = Array.from(mask, (cut, index) => {
        if (cut) return ink.bg
        const x = (index % SAMPLE_WIDTH + 0.5) / SAMPLE_WIDTH
        const y = (Math.floor(index / SAMPLE_WIDTH) + 0.5) / SAMPLE_HEIGHT
        const painted = block
          ? x >= block[0] && x < block[0] + block[2] && y >= block[1] && y < block[1] + block[3]
          : glyph[index]
        return painted ? original.fg : original.bg
      })
      const fitted = fitBlock(colors, [...new Set([original.fg, original.bg])], ink.bg)
      if (fitted.code !== original.code || fitted.fg !== original.fg || fitted.bg !== original.bg) edits.set(id, fitted)
    }
  } else {
    for (let row = Math.max(Math.floor(first), -path.origin); row < Math.ceil(last); row++) {
      const lines = linesAt(row)
      for (let x = Math.max(0, Math.floor(left)); x < Math.min(width, Math.ceil(right)); x++) {
        const mask = coverage(lines, x)
        if (!mask.some(Boolean)) continue
        const cell = fitBlock(Array.from(mask, inside => inside ? ink.fg : ink.bg), [ink.fg], ink.bg)
        if (cell.code !== 32 || ink.fg === ink.bg) {
          edits.set(key(x, path.origin + row), ink.fg === ink.bg ? { code: 219, ...ink } : cell)
        }
      }
    }
  }
  return edits
}
