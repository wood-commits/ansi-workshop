import { EMPTY, MAX_ROW, WIDTH, key, validateWidth, type Cell } from './model'
import { readSauce, type SauceMetadata } from './sauce'

const ansiOrder = [0, 4, 2, 6, 1, 5, 3, 7]

export class AnsiDecoder {
  private cells = new Map<string, Cell>()
  private x = 0
  private y = 0
  private fg = 7
  private bg = 0
  private bold = false
  private brightBackground = false
  private autowrap = true
  private wrap = false
  private saved = { x: 0, y: 0 }
  private state: 'text' | 'escape' | 'csi' = 'text'
  private parameters = ''
  private offset = 0
  private ended = false
  constructor(private readonly width = WIDTH, private readonly format: 'ansi' | 'ice' = 'ansi') {
    validateWidth(width)
  }

  get screen(): ReadonlyMap<string, Cell> { return this.cells }

  private fail(message: string): never {
    throw new Error(`${message} (byte ${this.offset}).`)
  }
  private move(x: number, y: number): void {
    // Export appends CRLF even after the last representable document row.
    if (!Number.isSafeInteger(y) || y < 0 || y > MAX_ROW + 1) this.fail('ANSI cursor exceeds safe row precision')
    this.x = Math.min(this.width - 1, Math.max(0, x))
    this.y = y
    this.wrap = false
  }
  private writeCell(code: number, x = this.x): void {
    if (this.y > MAX_ROW) this.fail('ANSI cell exceeds safe row precision')
    const cell = { code, fg: this.bold && this.fg < 8 ? this.fg + 8 : this.fg, bg: this.bg | (this.brightBackground ? 8 : 0) }
    const id = key(x, this.y)
    if (cell.code === EMPTY.code && cell.fg === EMPTY.fg && cell.bg === EMPTY.bg) this.cells.delete(id)
    else this.cells.set(id, cell)
  }
  private control(command: string): void {
    if (this.parameters.startsWith('?')) {
      if (this.parameters !== '?7' || (command !== 'h' && command !== 'l')) this.fail('Unsupported ANSI private mode')
      this.autowrap = command === 'h'
      this.wrap = false
      return
    }
    const values = this.parameters.split(';').map(value => Number(value))
    if (values.some(value => !Number.isSafeInteger(value))) this.fail('ANSI parameter exceeds safe integer precision')
    const count = values[0] || 1
    if (command === 'm') {
      for (const value of values) {
        if (value === 0) { this.fg = 7; this.bg = 0; this.bold = false; this.brightBackground = false }
        else if (value === 1) this.bold = true
        else if (value === 22) this.bold = false
        else if (value >= 30 && value <= 37) this.fg = ansiOrder[value - 30]
        else if (value >= 90 && value <= 97) this.fg = ansiOrder[value - 90] + 8
        else if (value === 39) this.fg = 7
        else if (value >= 40 && value <= 47) this.bg = ansiOrder[value - 40]
        else if (value >= 100 && value <= 107 && this.format === 'ice') this.bg = ansiOrder[value - 100] + 8
        else if (value === 49) this.bg = 0
        else if (value === 5 && this.format === 'ice') this.brightBackground = true
        else if (value === 25 && this.format === 'ice') this.brightBackground = false
        else if (value === 5 || value === 6) this.fail('ANSI blink is not supported')
        else if (value >= 100 && value <= 107) this.fail('Bright ANSI backgrounds are not supported')
        else this.fail(`Unsupported ANSI color or attribute ${value}`)
      }
      return
    }
    if (command === 'H' || command === 'f') {
      if (values.length > 2) this.fail('Unsupported ANSI cursor parameters')
      this.move((values[1] || 1) - 1, count - 1)
      return
    }
    if (values.length > 1) this.fail('Unsupported ANSI control parameters')
    switch (command) {
      case 'A': this.move(this.x, Math.max(0, this.y - count)); break
      case 'B': this.move(this.x, this.y + count); break
      case 'C':
        // Art compressors use cursor-forward for a gap just after DOS autowrap.
        if (this.wrap) this.move(0, this.y + 1)
        this.move(Math.min(this.width - 1, this.x + count), this.y)
        break
      case 'D': this.move(Math.max(0, this.x - count), this.y); break
      case 'E': this.move(0, this.y + count); break
      case 'F': this.move(0, Math.max(0, this.y - count)); break
      case 'G': this.move(count - 1, this.y); break
      case 'd': this.move(this.x, count - 1); break
      case 's':
        if (this.parameters) this.fail('Unsupported ANSI save-cursor parameters')
        this.saved = { x: this.x, y: this.y }
        this.wrap = false
        break
      case 'u':
        if (this.parameters) this.fail('Unsupported ANSI restore-cursor parameters')
        this.move(this.saved.x, this.saved.y)
        break
      case 'J':
        if (values[0] !== 2) this.fail('Unsupported ANSI display erase mode; only CSI 2 J is supported')
        if (this.bg !== 0 || this.brightBackground) this.fail('ANSI display erase with a colored background is not supported')
        // A sparse document has no fixed terminal screen height to fill.
        this.cells.clear()
        this.wrap = false
        break
      case 'K': {
        const mode = values[0]
        if (mode > 2) this.fail('Unsupported ANSI line erase mode')
        const left = mode === 0 ? this.x : 0
        const right = mode === 1 ? this.x : this.width - 1
        for (let x = left; x <= right; x++) this.writeCell(32, x)
        this.wrap = false
        break
      }
      default: this.fail(`Unsupported ANSI command ${command}`)
    }
  }

  write(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.offset++
      if (this.ended) {
        if (byte !== 26) this.fail('Unexpected data after DOS end-of-file marker')
        continue
      }
      if (this.state === 'escape') {
        if (byte !== 91) this.fail('Unsupported ANSI escape sequence')
        this.state = 'csi'
        this.parameters = ''
      } else if (this.state === 'csi') {
        if ((byte >= 48 && byte <= 57) || byte === 59 || (byte === 63 && !this.parameters)) {
          this.parameters += String.fromCharCode(byte)
          if (this.parameters.length > 128) this.fail('ANSI control sequence is too long')
        } else if (byte >= 64 && byte <= 126) {
          this.control(String.fromCharCode(byte))
          this.state = 'text'
        } else this.fail('Unsupported or malformed ANSI control sequence')
      } else if (byte === 27) this.state = 'escape'
      else if (byte === 26) this.ended = true
      else if (byte === 13) this.move(0, this.y)
      // A bare LF follows DOS autowrap; a preceding CR has canceled pending wrap.
      else if (byte === 10) this.move(0, this.y + (this.wrap ? 2 : 1))
      else if (byte === 9) this.move((Math.floor(this.x / 8) + 1) * 8, this.y)
      else if (byte === 8) this.move(this.x - 1, this.y)
      else if (byte < 32) this.fail(`Unsupported control byte ${byte}`)
      else {
        if (this.wrap) this.move(0, this.y + 1)
        this.writeCell(byte)
        if (this.x === this.width - 1) this.wrap = this.autowrap
        else this.x++
      }
    }
  }

  finish(): ReadonlyMap<string, Cell> {
    if (this.state !== 'text') this.fail('Incomplete ANSI escape sequence')
    return this.cells
  }
}

export async function readAnsi(file: Blob, signal: AbortSignal): Promise<ReadonlyMap<string, Cell>> {
  const document = await readAnsiDocument(file, signal)
  if (document.width !== WIDTH || document.format !== 'ansi') throw new Error('This workflow requires 80-column classic ANSI art; iCE colors are not supported here.')
  return document.cells
}

export async function readAnsiDocument(file: Blob, signal: AbortSignal, columns = WIDTH, mode: 'ansi' | 'ice' = 'ansi'): Promise<{
  cells: ReadonlyMap<string, Cell>; sauce?: SauceMetadata; width: number; format: 'ansi' | 'ice'
}> {
  signal.throwIfAborted()
  validateWidth(columns)
  let reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | undefined
  let abortRead: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    abortRead = () => reject(signal.reason)
    signal.addEventListener('abort', abortRead, { once: true })
  })
  try {
    const { content, sauce, width: declaredWidth } = await Promise.race([readSauce(file), aborted])
    signal.throwIfAborted()
    const width = declaredWidth ?? columns
    const format = sauce ? sauce.flags & 1 ? 'ice' : 'ansi' : mode
    const decoder = new AnsiDecoder(width, format)
    reader = content.stream().getReader()
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await Promise.race([reader.read(), aborted])
      signal.throwIfAborted()
      if (done) return { cells: decoder.finish(), sauce, width, format }
      decoder.write(value)
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  } catch (error) {
    try { await reader?.cancel() } catch (cancelError) {
      if (cancelError !== error) {
        throw new AggregateError([error, cancelError], 'Opening failed and the browser could not cancel the file reader.', { cause: cancelError })
      }
    }
    throw error
  } finally {
    if (abortRead) signal.removeEventListener('abort', abortRead)
    reader?.releaseLock()
  }
}
