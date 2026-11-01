import { colorCss, rgbColor } from './colors'
import { EMPTY, WIDTH, key, pointFromKey, validPoint, validateCell, type Cell } from './model'
import { readSauce, withSauce, type SauceMetadata } from './sauce'

const HEADER = [24, 84, 85, 78, 68, 82, 65, 50, 52]

export class TundraDecoder {
  private cells = new Map<string, Cell>()
  private record: number[] = []
  private header = false
  private offset = 0
  private x = 0
  private y = 0
  private fg = 7
  private bg = 0
  private ended = false

  private fail(message: string): never { throw new Error(`${message} (byte ${this.offset}).`) }

  write(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.offset++
      if (this.ended) {
        if (byte !== 26 && byte !== 32) this.fail('Unexpected data after Tundra end-of-file marker')
        continue
      }
      this.record.push(byte)
      if (!this.header) {
        if (byte !== HEADER[this.record.length - 1]) this.fail('Invalid Tundra24 signature or version')
        if (this.record.length === HEADER.length) { this.header = true; this.record = [] }
        continue
      }
      const command = this.record[0]
      if (command === 26) { this.ended = true; this.record = []; continue }
      const length = command === 1 ? 9 : command === 6 ? 10 : command === 2 || command === 4 ? 6 : 1
      if (this.record.length < length) continue
      if (command === 1) {
        const view = new DataView(new Uint8Array(this.record).buffer)
        this.y = view.getUint32(1); this.x = view.getUint32(5)
        if (!validPoint({ x: this.x, y: this.y })) this.fail('Tundra position must be within 80 columns')
      } else {
        if (this.y > 0xffffffff) this.fail('Tundra cursor exceeds its 32-bit row field')
        let code = command
        if (command === 2 || command === 4 || command === 6) {
          code = this.record[1]
          let index = 2
          const color = () => {
            // The high byte is unused; only the low 24 bits encode RGB.
            index++
            const hex = this.record.slice(index, index + 3).map(value => value.toString(16).padStart(2, '0')).join('')
            index += 3
            return rgbColor(`#${hex}`)
          }
          if (command & 2) this.fg = color()
          if (command & 4) this.bg = color()
        }
        if (code !== 0) {
          if (code < 32) this.fail(`Unsupported Tundra glyph byte ${code}; use graphical bytes 32-255`)
          const cell = { code, fg: this.fg, bg: this.bg }
          validateCell(cell, 'tundra')
          const id = key(this.x, this.y)
          if (cell.code === EMPTY.code && cell.fg === EMPTY.fg && cell.bg === EMPTY.bg) this.cells.delete(id)
          else this.cells.set(id, cell)
        }
        if (++this.x === WIDTH) { this.x = 0; this.y++ }
      }
      this.record = []
    }
  }

  finish(): ReadonlyMap<string, Cell> {
    if (!this.header || this.record.length) this.fail('Truncated Tundra record')
    return this.cells
  }
}

export function* tundraChunks(cells: ReadonlyMap<string, Cell>, sauce?: SauceMetadata): Generator<Uint8Array<ArrayBuffer>> {
  if (sauce) {
    let height = 1
    for (const id of cells.keys()) height = Math.max(height, pointFromKey(id).y + 1)
    yield* withSauce(tundraChunks(cells), sauce, height, 'tundra')
    return
  }
  yield new Uint8Array(HEADER)
  let x = 0, y = 0, fg = 7, bg = 0
  const ordered = [...cells].sort(([a], [b]) => {
    const left = pointFromKey(a), right = pointFromKey(b)
    return left.y - right.y || left.x - right.x
  })
  let bytes: number[] = []
  for (const [id, cell] of ordered) {
    const point = pointFromKey(id)
    if (!validPoint(point) || point.y > 0xffffffff) throw new Error('Tundra export positions require 80 columns and unsigned 32-bit rows.')
    validateCell(cell, 'tundra')
    if (point.x !== x || point.y !== y) {
      const position = new Uint8Array(9)
      position[0] = 1
      const view = new DataView(position.buffer)
      view.setUint32(1, point.y); view.setUint32(5, point.x)
      bytes.push(...position)
    }
    const command = (cell.fg !== fg ? 2 : 0) | (cell.bg !== bg ? 4 : 0)
    if (command) {
      bytes.push(command, cell.code)
      for (const value of [ ...(command & 2 ? [cell.fg] : []), ...(command & 4 ? [cell.bg] : []) ]) {
        const hex = colorCss(value)
        bytes.push(0, ...[1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16)))
      }
    } else bytes.push(cell.code)
    fg = cell.fg; bg = cell.bg
    x = (point.x + 1) % WIDTH; y = point.y + Number(x === 0)
    if (bytes.length >= 4096) { yield new Uint8Array(bytes); bytes = [] }
  }
  if (bytes.length) yield new Uint8Array(bytes)
}

export async function readTundraDocument(file: Blob, signal: AbortSignal): Promise<{ cells: ReadonlyMap<string, Cell>; sauce?: SauceMetadata }> {
  signal.throwIfAborted()
  const decoder = new TundraDecoder()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let abortRead: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    abortRead = () => reject(signal.reason)
    signal.addEventListener('abort', abortRead, { once: true })
  })
  try {
    const { content, sauce } = await Promise.race([readSauce(file, 'tundra'), aborted])
    signal.throwIfAborted()
    reader = content.stream().getReader()
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted])
      signal.throwIfAborted()
      if (done) return { cells: decoder.finish(), sauce }
      decoder.write(value)
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  } catch (error) {
    try { await reader?.cancel() } catch (cancelError) {
      if (cancelError !== error) throw new AggregateError([error, cancelError], 'Opening failed and the browser could not cancel the file reader.', { cause: cancelError })
    }
    throw error
  } finally {
    if (abortRead) signal.removeEventListener('abort', abortRead)
    reader?.releaseLock()
  }
}
