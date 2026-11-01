// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ansiChunks } from './export'
import { AnsiDecoder, readAnsi } from './import'
import { Editor, MAX_ROW } from './model'

const bytes = (text: string) => Uint8Array.from(text, char => char.charCodeAt(0))
function decode(text: string) {
  const decoder = new AnsiDecoder()
  decoder.write(bytes(text))
  return decoder.finish()
}

function sauceFile(text: string, comments = 0) {
  const record = new Uint8Array(128)
  record.set(bytes('SAUCE00'))
  record[94] = 1
  record[95] = 1
  record[96] = 80
  record[104] = comments
  const commentBlock = comments ? new Uint8Array(5 + comments * 64) : new Uint8Array()
  if (comments) commentBlock.set(bytes('COMNT'))
  return { record, commentBlock, file: () => new Blob([bytes(text), commentBlock, record]) }
}

describe('CP437 ANSI import', () => {
  it('round-trips every printable CP437 byte, all colors, colored spaces, gaps, and column 80', () => {
    const source = new Editor()
    for (let code = 32; code <= 255; code++) {
      const index = code - 32
      source.paint({ x: index % 80, y: Math.floor(index / 80) }, { code, fg: code % 16, bg: code % 8 })
    }
    source.paint({ x: 79, y: 8 }, { code: 32, fg: 14, bg: 1 })
    source.commit()
    const decoder = new AnsiDecoder()
    for (const chunk of ansiChunks(source.cells)) {
      // Escape sequences may cross any input chunk boundary.
      for (const byte of chunk) decoder.write(new Uint8Array([byte]))
    }
    const cells = decoder.finish()
    expect(cells).toEqual(source.cells)
    expect([...ansiChunks(cells)]).toEqual([...ansiChunks(source.cells)])
    const loaded = new Editor(cells)
    expect(loaded.dirty).toBe(false)
    expect(loaded.canUndo).toBe(false)
    loaded.paint({ x: 0, y: 0 }, { code: 65, fg: 7, bg: 0 })
    loaded.commit()
    expect(loaded.dirty).toBe(true)
    loaded.undo()
    expect(loaded.cells).toEqual(cells)
    expect(loaded.dirty).toBe(false)
  })

  it('defers column-80 wrapping so an exported CRLF does not insert a blank line', () => {
    const cells = decode('A'.repeat(80) + '\r\nB')
    expect(cells.get('79,0')?.code).toBe(65)
    expect(cells.get('0,1')?.code).toBe(66)
    expect(decode('A'.repeat(80) + 'B').get('0,1')?.code).toBe(66)
  })

  it('starts LF-only lines at column zero, including across chunks', () => {
    const decoder = new AnsiDecoder()
    for (const byte of bytes('ABC\nD\x1b[2CE\n' + 'X'.repeat(79) + '\x1b[0m\nY')) {
      decoder.write(new Uint8Array([byte]))
    }
    expect(decoder.finish()).toEqual(decode('ABC\r\nD\x1b[2CE\r\n' + 'X'.repeat(79) + '\x1b[0m\r\nY'))
    expect(decoder.finish().get('0,3')?.code).toBe(89)
  })

  it('preserves bare LF after DOS autowrap while CRLF cancels deferred wrap', () => {
    expect(decode('X'.repeat(80) + '\x1b[0m\nY').get('0,2')?.code).toBe(89)
    expect(decode('X'.repeat(80) + '\x1b[0m\r\nY').get('0,1')?.code).toBe(89)
    expect(decode('\x1b[?7l' + 'X'.repeat(80) + '\nY').get('0,1')?.code).toBe(89)
    expect(() => decode(`\x1b[${MAX_ROW + 1};80HX\n`)).toThrow('safe row precision')
  })

  it('honors explicit ANSI autowrap enable/disable without allocating terminal state', () => {
    expect(decode('\x1b[?7h' + 'A'.repeat(80) + '\x1b[31mB').get('0,1'))
      .toEqual({ code: 66, fg: 4, bg: 0 })
    const cells = decode('\x1b[?7l' + 'A'.repeat(80) + 'BC\nD')
    expect(cells.get('79,0')?.code).toBe(67)
    expect(cells.get('0,1')?.code).toBe(68)
    expect(decode('\x1b[?7l' + 'A'.repeat(80) + '\x1b[?7hBC').get('0,1')?.code).toBe(67)
  })

  it('keeps compressed cursor-forward gaps on the next row after a full-width row', () => {
    const cells = decode('A'.repeat(80) + '\x1b[31m\x1b[2CB')
    expect(cells.get('79,0')).toEqual({ code: 65, fg: 7, bg: 0 })
    expect(cells.get('2,1')).toEqual({ code: 66, fg: 4, bg: 0 })
    expect(cells.size).toBe(81)
    expect(decode('\x1b[?7l' + 'A'.repeat(80) + '\x1b[2CB').get('79,0')?.code).toBe(66)
  })

  it('accepts a final exported CRLF at the safe row boundary without permitting another cell', () => {
    const text = `\x1b[${MAX_ROW + 1};80HX\x1b[0m\r\n\x1b[0m`
    expect(decode(text)).toEqual(new Map([[`79,${MAX_ROW}`, { code: 88, fg: 7, bg: 0 }]]))
    expect(() => decode(text + 'Y')).toThrow('safe row precision')
  })

  it('supports DOS color order, bold, normal intensity, and default colors', () => {
    const cells = decode('\x1b[1;31;44mA\x1b[22mB\x1b[93mC\x1b[39;49mD\x1b[mE')
    expect([...cells.values()]).toEqual([
      { code: 65, fg: 12, bg: 1 }, { code: 66, fg: 4, bg: 1 },
      { code: 67, fg: 14, bg: 1 }, { code: 68, fg: 7, bg: 0 },
      { code: 69, fg: 7, bg: 0 },
    ])
  })

  it('handles sparse cursor positioning, relative motion, saved cursors, tabs and backspaces', () => {
    const cells = decode('\x1b[1000000001;80HX\x1b[s\x1b[2A\x1b[79DY\x1b[uZ\r\nA\tB\bC')
    expect(cells.size).toBe(4)
    expect(cells.get('0,999999998')?.code).toBe(89)
    expect(cells.get('79,1000000000')?.code).toBe(90)
    expect(cells.get('0,1000000001')?.code).toBe(65)
    expect(cells.get('8,1000000001')?.code).toBe(67)
  })

  it('clears the display and erases lines without leaving default blanks allocated', () => {
    expect(decode('ABC\x1b[2J\x1b[HX')).toEqual(new Map([['0,0', { code: 88, fg: 7, bg: 0 }]]))
    expect(decode('ABC\r\x1b[2K').size).toBe(0)
    const cells = decode('ABC\r\x1b[44m\x1b[K')
    expect(cells.size).toBe(80)
    expect(cells.get('79,0')).toEqual({ code: 32, fg: 7, bg: 1 })
  })

  it.each([
    ['\x1b', 'Incomplete'], ['\x1b[31', 'Incomplete'],
    ['\x1b]0;title\x07', 'Unsupported'], ['\x00', 'Unsupported'],
    ['\x1b[5mA', 'blink'], ['\x1b[101mA', 'background'],
    ['\x1b[38;5;1mA', 'Unsupported'], ['\x1b[?25l', 'Unsupported'],
    ['\x1b[?7;25h', 'Unsupported'], ['\x1b[7h', 'Unsupported'],
    ['\x1b[3?7h', 'Unsupported'], ['\x1b[?7m', 'Unsupported'],
    ['\x1b[' + '1'.repeat(129) + 'm', 'too long'],
    ['\x1b[9007199254740992B', 'safe'],
    [`\x1b[${MAX_ROW + 2};1HX`, 'safe'],
    ['\x1b[44m\x1b[2J', 'background'],
  ])('rejects unsupported or malformed input without executing it: %j', (text, message) => {
    expect(() => decode(text)).toThrow(message)
  })

  it('accepts empty files and an optional final DOS end-of-file marker', () => {
    expect(decode('').size).toBe(0)
    expect(decode('A\x1a').size).toBe(1)
    expect(() => decode('A\x1aB')).toThrow('end-of-file')
  })

  it('accepts repeated trailing DOS EOF padding across chunks but rejects other trailing bytes', () => {
    const decoder = new AnsiDecoder()
    decoder.write(bytes('A\x1a'))
    decoder.write(bytes('\x1a\x1a'))
    expect(decoder.finish()).toEqual(decode('A'))
    expect(() => decoder.write(bytes('B'))).toThrow('end-of-file')
    expect(() => decode('A\x1a\x00')).toThrow('end-of-file')
  })

  it('streams files and supports explicit cancellation', async () => {
    expect(await readAnsi(new Blob([bytes('\x1b[92m\xdb')]), new AbortController().signal))
      .toEqual(new Map([['0,0', { code: 219, fg: 10, bg: 0 }]]))
    const controller = new AbortController()
    controller.abort()
    await expect(readAnsi(new Blob([bytes('A')]), controller.signal)).rejects.toHaveProperty('name', 'AbortError')
  })

  it.each(['', '\x1a', '\x1a\x1a'])('opens a SAUCE00 ANSI trailer with optional DOS EOF %j', async eof => {
    const sauce = sauceFile('\x1b[93;44m\xdb' + eof)
    // FileSize is advisory and often stale in existing art packs.
    new DataView(sauce.record.buffer).setUint32(90, 0xffffffff, true)
    const cells = await readAnsi(sauce.file(), new AbortController().signal)
    expect(cells).toEqual(new Map([['0,0', { code: 219, fg: 14, bg: 1 }]]))
    expect([...ansiChunks(cells)].flatMap(chunk => [...chunk])).toEqual([
      27, 91, 48, 109, 27, 91, 50, 74, 27, 91, 72,
      27, 91, 57, 51, 59, 52, 52, 109, 219,
      27, 91, 48, 109, 13, 10, 27, 91, 48, 109,
    ])
  })

  it.each([1, 255])('strips %i fixed-size SAUCE comments without interpreting their controls', async count => {
    const sauce = sauceFile('A\x1a', count)
    sauce.commentBlock.set(bytes('\x1b]not ANSI\x00'), 5)
    expect(await readAnsi(sauce.file(), new AbortController().signal))
      .toEqual(new Map([['0,0', { code: 65, fg: 7, bg: 0 }]]))
  })

  it('reads only the bounded record and comment block before streaming the content', async () => {
    const file = sauceFile('A\x1a', 255).file()
    const slice = vi.spyOn(file, 'slice')
    await readAnsi(file, new AbortController().signal)
    expect(slice.mock.calls).toEqual([
      [file.size - 128], [2, 2 + 5 + 255 * 64], [0, 2],
    ])
  })

  it('accepts SAUCE ASCII and unspecified dimensions without allocating metadata-sized rows', async () => {
    const sauce = sauceFile('A')
    sauce.record[95] = 0
    sauce.record[96] = 0
    sauce.record[98] = 255
    sauce.record[99] = 255
    expect((await readAnsi(sauce.file(), new AbortController().signal)).size).toBe(1)
  })

  it.each([
    [5, 49, 'version'], [94, 5, 'file type'], [95, 2, 'file type'],
    [96, 132, '80-column'], [105, 1, 'iCE'],
  ])('rejects unsupported SAUCE fields at offset %i', async (offset, value, message) => {
    const sauce = sauceFile('A\x1a')
    sauce.record[offset] = value
    await expect(readAnsi(sauce.file(), new AbortController().signal)).rejects.toThrow(message)
  })

  it('rejects malformed or truncated SAUCE comments and unrecognized trailing data', async () => {
    const sauce = sauceFile('A\x1a', 1)
    sauce.commentBlock[0] = 0
    await expect(readAnsi(sauce.file(), new AbortController().signal)).rejects.toThrow('comment')
    await expect(readAnsi(new Blob([bytes('A\x1a'), sauce.record]), new AbortController().signal)).rejects.toThrow('comment')
    await expect(readAnsi(new Blob([bytes('A\x1a'), new Uint8Array(128)]), new AbortController().signal)).rejects.toThrow('end-of-file')
    const extra = sauceFile('A\x1aB')
    await expect(readAnsi(extra.file(), new AbortController().signal)).rejects.toThrow('end-of-file')
  })

  it('does not bypass ANSI control validation when SAUCE is present', async () => {
    await expect(readAnsi(sauceFile('\x1b[5mA\x1a').file(), new AbortController().signal)).rejects.toThrow('blink')
  })

  it('cancels while reading the bounded SAUCE record before creating a stream', async () => {
    const file = sauceFile('A\x1a').file()
    const tail = new Blob()
    vi.spyOn(tail, 'arrayBuffer').mockReturnValue(new Promise(() => {}))
    vi.spyOn(file, 'slice').mockReturnValue(tail)
    const stream = vi.spyOn(file, 'stream')
    const controller = new AbortController()
    const reading = readAnsi(file, controller.signal)
    controller.abort()
    await expect(reading).rejects.toHaveProperty('name', 'AbortError')
    expect(stream).not.toHaveBeenCalled()
  })

  it('cancels and releases a reader when opening is aborted during a read', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      cancel,
    })
    const file = new Blob()
    vi.spyOn(file, 'stream').mockReturnValue(stream)
    const controller = new AbortController()
    const reading = readAnsi(file, controller.signal)
    await vi.waitFor(() => expect(stream.locked).toBe(true))
    controller.abort()
    await expect(reading).rejects.toHaveProperty('name', 'AbortError')
    expect(cancel).toHaveBeenCalledOnce()
    expect(stream.locked).toBe(false)
  })

  it('surfaces read errors and cancellation failures and releases the reader', async () => {
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) { controller.enqueue(bytes('\x1b]')) },
      cancel() { throw new Error('Reader cancellation failed') },
    })
    const file = new Blob()
    vi.spyOn(file, 'stream').mockReturnValue(stream)
    await expect(readAnsi(file, new AbortController().signal)).rejects.toBeInstanceOf(AggregateError)
    expect(stream.locked).toBe(false)
    const failed = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) { controller.error(new Error('Read failed')) },
    })
    vi.spyOn(file, 'stream').mockReturnValue(failed)
    await expect(readAnsi(file, new AbortController().signal)).rejects.toThrow('Read failed')
    expect(failed.locked).toBe(false)
  })
})
