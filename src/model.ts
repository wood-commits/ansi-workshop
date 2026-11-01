import { flipCharacter } from './ansi'
import { validColor, type DocumentFormat } from './colors'
import { copySauce, sameSauce, validateSauce, type SauceMetadata } from './sauce'

export const WIDTH = 80
export const MAX_COLUMNS = 512
export function validateWidth(width: number): void {
  if (!Number.isInteger(width) || width < 1 || width > MAX_COLUMNS) throw new Error(`Document columns must be an integer from 1 to ${MAX_COLUMNS}.`)
}
export const MAX_ROW = Number.MAX_SAFE_INTEGER - 1000
export interface Point { x: number; y: number }
export interface Cell { code: number; fg: number; bg: number }
export interface Rect { left: number; top: number; right: number; bottom: number }
export const EMPTY: Readonly<Cell> = Object.freeze({ code: 32, fg: 7, bg: 0 })
export interface Block { width: number; height: number; cells: ReadonlyMap<string, Cell> }
interface Change { point: Point; before: Cell; after: Cell }
interface Transaction { changes: Change[]; beforeId: number; afterId: number; metadata?: { before?: SauceMetadata; after?: SauceMetadata } }

export function key(x: number, y: number): string { return `${x},${y}` }
export function pointFromKey(value: string): Point {
  const [x, y] = value.split(',').map(Number)
  return { x, y }
}
export function validPoint({ x, y }: Point, width = WIDTH): boolean {
  return Number.isInteger(width) && width >= 1 && width <= MAX_COLUMNS &&
    Number.isSafeInteger(x) && x >= 0 && x < width && Number.isSafeInteger(y) && y >= 0 && y < Number.MAX_SAFE_INTEGER
}
export function rectangle(a: Point, b: Point): Rect {
  return { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) }
}
export function contains(rect: Rect, point: Point): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
}
function same(a: Cell, b: Cell): boolean { return a.code === b.code && a.fg === b.fg && a.bg === b.bg }
export function validateCell(cell: Cell, format: DocumentFormat = 'ansi'): void {
  if (!Number.isInteger(cell.code) || cell.code < 32 || cell.code > 255 ||
      !validColor(cell.fg, false, format) || !validColor(cell.bg, true, format)) {
    throw new Error(format === 'tundra' ? 'Invalid Tundra cell: use CP437 bytes 32-255 and valid RGB colors.'
      : `Invalid cell: use CP437 bytes 32-255, foreground colors 0-15, and background colors 0-${format === 'ice' ? 15 : 7}.`)
  }
}

export class Editor {
  private data = new Map<string, Cell>()
  private undoStack: Transaction[] = []
  private redoStack: Transaction[] = []
  private pending = new Map<string, Change>()
  private sequence = 0
  private stateId = 0
  private savedId = 0
  private metadata: SauceMetadata | undefined
  constructor(cells?: ReadonlyMap<string, Cell>, sauce?: SauceMetadata, readonly format: DocumentFormat = 'ansi', readonly width = WIDTH) {
    validateWidth(width)
    this.metadata = copySauce(sauce)
    for (const [id, cell] of cells ?? []) {
      const point = pointFromKey(id)
      if (!validPoint(point, this.width)) throw new Error(`Document coordinates must be safe, nonnegative integers within ${this.width} columns.`)
      validateCell(cell, this.format)
      this.write(point, cell)
    }
  }
  get cells(): ReadonlyMap<string, Cell> { return this.data }
  get sauce(): SauceMetadata | undefined { return this.metadata }
  get dirty(): boolean { return this.stateId !== this.savedId || this.pending.size > 0 }
  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
  get version(): number { return this.stateId }
  get lastRow(): number {
    let last = 0
    for (const value of this.data.keys()) last = Math.max(last, pointFromKey(value).y)
    return last
  }
  cell(point: Point): Cell { return this.data.get(key(point.x, point.y)) ?? EMPTY }
  private write(point: Point, cell: Cell): void {
    const id = key(point.x, point.y)
    if (same(cell, EMPTY)) this.data.delete(id)
    else this.data.set(id, { ...cell })
  }
  paint(point: Point, cell: Cell): void {
    if (!validPoint(point, this.width)) throw new Error(`Cursor coordinates must be safe, nonnegative integers within ${this.width} columns.`)
    validateCell(cell, this.format)
    const before = this.cell(point)
    if (same(before, cell)) return
    const id = key(point.x, point.y)
    const existing = this.pending.get(id)
    this.pending.set(id, { point: { ...point }, before: existing?.before ?? { ...before }, after: { ...cell } })
    this.write(point, cell)
  }
  commit(): void {
    const changes = [...this.pending.values()].filter(change => !same(change.before, change.after))
    this.pending.clear()
    if (!changes.length) return
    const afterId = ++this.sequence
    this.undoStack.push({ changes, beforeId: this.stateId, afterId })
    this.stateId = afterId
    this.redoStack = []
  }
  setSauce(sauce: SauceMetadata | undefined): void {
    if (sauce) validateSauce(sauce, this.format)
    this.commit()
    if (sameSauce(this.metadata, sauce)) return
    const after = copySauce(sauce)
    const afterId = ++this.sequence
    this.undoStack.push({ changes: [], beforeId: this.stateId, afterId, metadata: { before: this.metadata, after } })
    this.metadata = after
    this.stateId = afterId
    this.redoStack = []
  }
  undo(): void {
    this.commit()
    const transaction = this.undoStack.pop()
    if (!transaction) return
    for (const change of transaction.changes) this.write(change.point, change.before)
    if (transaction.metadata) this.metadata = transaction.metadata.before
    this.stateId = transaction.beforeId
    this.redoStack.push(transaction)
  }
  redo(): void {
    const transaction = this.redoStack.pop()
    if (!transaction) return
    for (const change of transaction.changes) this.write(change.point, change.after)
    if (transaction.metadata) this.metadata = transaction.metadata.after
    this.stateId = transaction.afterId
    this.undoStack.push(transaction)
  }
  markSaved(version = this.stateId): void { this.savedId = version }
  copy(rect: Rect): Block {
    const cells = new Map<string, Cell>()
    for (const [id, cell] of this.data) {
      const point = pointFromKey(id)
      if (contains(rect, point)) cells.set(key(point.x - rect.left, point.y - rect.top), { ...cell })
    }
    return { width: rect.right - rect.left + 1, height: rect.bottom - rect.top + 1, cells }
  }
  clear(rect: Rect): void {
    for (const id of [...this.data.keys()]) {
      const point = pointFromKey(id)
      if (contains(rect, point)) this.paint(point, EMPTY)
    }
  }
  paste(block: Block, origin: Point): void {
    if (!validPoint(origin, this.width) || !Number.isSafeInteger(origin.y + block.height - 1) ||
        origin.y + block.height - 1 >= Number.MAX_SAFE_INTEGER) throw new Error('The pasted block exceeds safe coordinate precision.')
    for (const cell of block.cells.values()) validateCell(cell, this.format)
    this.clear({ left: origin.x, top: origin.y, right: Math.min(this.width - 1, origin.x + block.width - 1), bottom: origin.y + block.height - 1 })
    for (const [id, cell] of block.cells) {
      const point = pointFromKey(id)
      if (origin.x + point.x < this.width) this.paint({ x: origin.x + point.x, y: origin.y + point.y }, cell)
    }
  }
  flip(rect: Rect, axis: 'x' | 'y'): void {
    const block = this.copy(rect)
    this.clear(rect)
    for (const [id, cell] of block.cells) {
      const point = pointFromKey(id)
      this.paint({
        x: rect.left + (axis === 'x' ? block.width - point.x - 1 : point.x),
        y: rect.top + (axis === 'y' ? block.height - point.y - 1 : point.y),
      }, { ...cell, code: flipCharacter(cell.code, axis) })
    }
  }
}

export function linePoints(a: Point, b: Point): Point[] {
  const points: Point[] = []
  let { x, y } = a
  const dx = Math.abs(b.x - x), sx = x < b.x ? 1 : -1
  const dy = -Math.abs(b.y - y), sy = y < b.y ? 1 : -1
  let error = dx + dy
  while (true) {
    points.push({ x, y })
    if (x === b.x && y === b.y) break
    const twice = 2 * error
    if (twice >= dy) { error += dy; x += sx }
    if (twice <= dx) { error += dx; y += sy }
  }
  return points
}
