import { EMPTY, pointFromKey, type Cell } from './model'
import { withSauce, type SauceMetadata } from './sauce'

const escape = 27
const ansiOrder = [0, 4, 2, 6, 1, 5, 3, 7]
export function sgr(cell: Cell, classicBright = false): number[] {
  const fg = (cell.fg < 8 || classicBright ? 30 : 90) + ansiOrder[cell.fg % 8]
  const bg = 40 + ansiOrder[cell.bg]
  const attributes = classicBright ? `0;${cell.fg >= 8 ? '1;' : ''}` : ''
  return [escape, ...Array.from(`[${attributes}${fg};${bg}m`, char => char.charCodeAt(0))]
}

// Yield bounded byte chunks, including for very distant sparse rows.
export function* ansiChunks(cells: ReadonlyMap<string, Cell>, sauce?: SauceMetadata): Generator<Uint8Array<ArrayBuffer>> {
  if (sauce) {
    let height = 1
    for (const id of cells.keys()) height = Math.max(height, pointFromKey(id).y + 1)
    yield* withSauce(artChunks(cells, true), sauce, height)
  } else yield* artChunks(cells, true)
}

export function* asciiChunks(cells: ReadonlyMap<string, Cell>): Generator<Uint8Array<ArrayBuffer>> {
  yield* artChunks(cells, false)
}

function* artChunks(cells: ReadonlyMap<string, Cell>, colors: boolean): Generator<Uint8Array<ArrayBuffer>> {
  const rows = new Map<number, Map<number, Cell>>()
  for (const [id, cell] of cells) {
    const { x, y } = pointFromKey(id)
    let row = rows.get(y)
    if (!row) { row = new Map(); rows.set(y, row) }
    row.set(x, cell)
  }
  if (colors) yield new Uint8Array([escape, 91, 48, 109, escape, 91, 50, 74, escape, 91, 72])
  let nextRow = 0
  let previous: Cell = EMPTY
  for (const [y, row] of [...rows].sort(([a], [b]) => a - b)) {
    let gap = y - nextRow
    while (gap > 0) {
      const count = Math.min(gap, 2048)
      const bytes = new Uint8Array(count * 2)
      for (let i = 0; i < bytes.length; i += 2) { bytes[i] = 13; bytes[i + 1] = 10 }
      yield bytes
      gap -= count
    }
    const bytes: number[] = []
    const lastColumn = Math.max(...row.keys())
    for (let x = 0; x <= lastColumn; x++) {
      const cell = row.get(x) ?? EMPTY
      if (colors && (cell.fg !== previous.fg || cell.bg !== previous.bg)) bytes.push(...sgr(cell))
      bytes.push(cell.code)
      previous = cell
    }
    // Reset before line feeds so colored backgrounds do not leak into blank rows.
    if (colors) bytes.push(escape, 91, 48, 109)
    bytes.push(13, 10)
    previous = EMPTY
    yield new Uint8Array(bytes)
    nextRow = y + 1
  }
  if (colors) yield new Uint8Array([escape, 91, 48, 109])
}
