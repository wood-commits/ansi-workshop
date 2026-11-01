// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ANSI_COLORS } from './ansi'
import { colorCss, rgbColor } from './colors'
import { Editor, EMPTY, key } from './model'
import { asciiChunks, ansiChunks } from './export'
import { readTundraDocument, TundraDecoder, tundraChunks } from './tundra'
import { emptySauce, validateSauce } from './sauce'
import { bucketFill } from './fill'
import { rasterizeGradient } from './gradient'

const header = [24, 84, 85, 78, 68, 82, 65, 50, 52]
const decode = (bytes: number[]) => {
  const decoder = new TundraDecoder()
  for (const byte of bytes) decoder.write(new Uint8Array([byte]))
  return decoder.finish()
}

describe('Tundra RGB documents', () => {
  it('keeps classic ANSI validation strict and RGB colors unambiguous', () => {
    expect(rgbColor('#aaaaaa')).toBe(7)
    expect(colorCss(rgbColor('#000007'))).toBe('#000007')
    ANSI_COLORS.forEach((color, index) => expect(colorCss(index)).toBe(color))
    const cell = { code: 219, fg: rgbColor('#123456'), bg: rgbColor('#abcdef') }
    expect(() => new Editor(new Map([['0,0', cell]]))).toThrow()
    const editor = new Editor(undefined, undefined, 'tundra')
    editor.paint({ x: 0, y: 1_000_000_000 }, cell); editor.commit()
    const version = editor.version
    editor.markSaved(version)
    editor.flip({ left: 0, right: 1, top: 1_000_000_000, bottom: 1_000_000_000 }, 'x')
    editor.commit()
    expect(editor.dirty).toBe(true)
    editor.undo()
    expect(editor.dirty).toBe(false)
    editor.redo()
    expect(editor.cell({ x: 1, y: 1_000_000_000 })).toEqual(cell)
    expect(editor.cells.size).toBe(1)
    for (const color of [16, -1, 0x2000000, NaN, 1.5]) {
      expect(() => editor.paint({ x: 0, y: 0 }, { ...cell, fg: color })).toThrow()
    }
    expect(() => editor.paint({ x: 0, y: 0 }, { ...cell, code: 27 })).toThrow()
  })

  it('encodes exact signature, big-endian position, and both RGB fields', () => {
    const cell = { code: 219, fg: rgbColor('#123456'), bg: rgbColor('#abcdef') }
    const cells = new Map([[key(2, 1_000_000_000), cell]])
    const bytes = [...tundraChunks(cells)].flatMap(chunk => [...chunk])
    expect(bytes).toEqual([
      ...header, 1, 59, 154, 202, 0, 0, 0, 0, 2,
      6, 219, 0, 18, 52, 86, 0, 171, 205, 239,
    ])
    expect(decode(bytes)).toEqual(cells)
  })

  it('decodes wrapping, color changes, skips, colored spaces, and overwrites', () => {
    const cells = decode([
      ...header, 1, 0, 0, 0, 0, 0, 0, 0, 79,
      2, 65, 0, 18, 52, 86, 4, 32, 0, 255, 255, 255, 0, 219,
    ])
    expect(cells.get('79,0')).toEqual({ code: 65, fg: rgbColor('#123456'), bg: 0 })
    expect(cells.get('0,1')).toEqual({ code: 32, fg: rgbColor('#123456'), bg: 15 })
    expect(cells.has('1,1')).toBe(false)
    expect(cells.get('2,1')).toEqual({ code: 219, fg: rgbColor('#123456'), bg: 15 })
    const bytes = [...tundraChunks(cells)].flatMap(chunk => [...chunk])
    expect(decode(bytes)).toEqual(cells)
    expect(decode([...header, 65, 1, 0, 0, 0, 0, 0, 0, 0, 0, 32]).size).toBe(0)
  })

  it('ignores unused color high bytes without shifting foreground, background or combined records', () => {
    const expected = new Map([
      ['0,0', { code: 65, fg: rgbColor('#123456'), bg: 0 }],
      ['1,0', { code: 66, fg: rgbColor('#123456'), bg: rgbColor('#abcdef') }],
      ['2,0', { code: 219, fg: rgbColor('#fedcba'), bg: rgbColor('#654321') }],
    ])
    for (let high = 0; high <= 255; high++) {
      const cells = decode([
        ...header, 2, 65, high, 18, 52, 86,
        4, 66, high, 171, 205, 239,
        6, 219, high, 254, 220, 186, 255 - high, 101, 67, 33,
      ])
      expect(cells).toEqual(expected)
      const saved = [...tundraChunks(cells)].flatMap(chunk => [...chunk])
      expect(saved).toEqual([
        ...header, 2, 65, 0, 18, 52, 86, 4, 66, 0, 171, 205, 239,
        6, 219, 0, 254, 220, 186, 0, 101, 67, 33,
      ])
      expect(decode(saved)).toEqual(expected)
    }
  })

  it('accepts nonzero unused bytes at the reported byte 226 while rejecting truncated color records', async () => {
    const bytes = [...header, ...Array<number>(207).fill(65), 6, 219, 255, 18, 52, 86, 128, 171, 205, 239]
    expect(bytes.length).toBe(226)
    const { cells } = await readTundraDocument(new Blob([new Uint8Array(bytes)]), new AbortController().signal)
    expect(cells.get('47,2')).toEqual({ code: 219, fg: rgbColor('#123456'), bg: rgbColor('#abcdef') })
    expect(() => decode(bytes.slice(0, -1))).toThrow(/Truncated Tundra record/)
  })

  it('ends at a record-boundary DOS EOF and ignores trailing spaces and repeated EOF padding', async () => {
    const art = [...header, 6, 219, 255, 18, 52, 86, 255, 171, 205, 239]
    const expected = new Map([['0,0', { code: 219, fg: rgbColor('#123456'), bg: rgbColor('#abcdef') }]])
    const padded = [...art, 26, ...Array<number>(79).fill(32), 26]
    expect(decode(padded)).toEqual(expected)
    expect((await readTundraDocument(new Blob([new Uint8Array(padded)]), new AbortController().signal)).cells).toEqual(expected)
    expect(decode([...header, 26, 32, 26]).size).toBe(0)
    for (const extra of [0, 1, 2, 6, 10, 27, 65, 219]) {
      expect(() => decode([...art, 26, 32, extra])).toThrow(/after Tundra end-of-file/)
    }
  })

  it('does not interpret DOS EOF bytes inside glyph/color records or strip valid color bytes before SAUCE', async () => {
    const cells = new Map([['0,0', { code: 219, fg: rgbColor('#12341a'), bg: rgbColor('#65431a') }]])
    const sauce = { ...emptySauce(), title: 'RGB ending in 1A' }
    const chunks = [...tundraChunks(cells, sauce)]
    const withoutEofSeparator = new Blob([...chunks.slice(0, -2), chunks.at(-1)!])
    expect(await readTundraDocument(withoutEofSeparator, new AbortController().signal)).toEqual({ cells, sauce })
    expect(decode([...header, 2, 219, 26, 26, 52, 86]).get('0,0')?.fg).toBe(rgbColor('#1a3456'))
    expect(() => decode([...header, 2, 219, 26, 26])).toThrow(/Truncated Tundra record/)
    expect(() => decode([...header, 2, 26, 0, 18, 52, 86])).toThrow()
  })

  it('rejects malformed, truncated and unsafe records without accepting control glyphs', () => {
    for (const bytes of [
      [], header.slice(0, 8), [23, ...header.slice(1)], [...header, 1],
      [...header, 6, 219, 0, 1], [...header, 27], [...header, 3],
      [...header, 2, 10, 0, 1, 2, 3],
      [...header, 1, 0, 0, 0, 0, 0, 0, 0, 80],
    ]) expect(() => decode(bytes)).toThrow()
  })

  it('bounds chunks, rejects unrepresentable export positions and ANSI color loss', () => {
    const cells = new Map([['0,0', { code: 65, fg: rgbColor('#123456'), bg: 15 }]])
    expect(() => [...ansiChunks(cells)]).toThrow()
    expect([...asciiChunks(cells)].flatMap(chunk => [...chunk])).toEqual([65, 13, 10])
    expect(() => [...tundraChunks(new Map([[key(0, 0x100000000), EMPTY]]))]).toThrow(/32-bit/)
    expect([...tundraChunks(new Map())].flatMap(chunk => [...chunk])).toEqual(header)
    const last = new Map([[key(79, 0xffffffff), { code: 219, fg: 7, bg: 0 }]])
    expect(decode([...tundraChunks(last)].flatMap(chunk => [...chunk]))).toEqual(last)
    const many = new Map(Array.from({ length: 5000 }, (_, i) => [key(i % 80, Math.floor(i / 80)), { code: 219, fg: 7, bg: 0 }]))
    expect([...tundraChunks(many)].every(chunk => chunk.length <= 4115)).toBe(true)
  })

  it('fills, gradients and pastes RGB blocks without partial ANSI mutations', () => {
    const fg = rgbColor('#123456'), bg = rgbColor('#abcdef')
    const cells = new Map([['0,0', { code: 219, fg, bg }], ['1,0', { code: 219, fg, bg }]])
    expect([...bucketFill(cells, { x: 0, y: 0 }, 'shape', bg, 'tundra').values()].every(cell => cell.fg === bg)).toBe(true)
    expect(rasterizeGradient(cells, 'linear', { x: 0, y: 0 }, { x: 1, y: 0 }, { fg, bg }, 'tundra').get('1,0')?.fg).toBe(bg)
    const editor = new Editor(cells, undefined, 'tundra')
    const block = editor.copy({ left: 0, right: 2, top: 0, bottom: 0 })
    editor.paste(block, { x: 78, y: 10 }); editor.commit()
    expect(editor.cell({ x: 79, y: 10 })).toEqual(cells.get('1,0'))
    const ansi = new Editor(new Map([['0,0', { code: 65, fg: 7, bg: 0 }]]))
    expect(() => ansi.paste(block, { x: 0, y: 0 })).toThrow()
    expect(ansi.cell({ x: 0, y: 0 }).code).toBe(65)
    expect(ansi.dirty).toBe(false)
  })

  it('streams files with Tundra SAUCE metadata and rejects mismatched trailers', async () => {
    const cells = new Map([['79,2', { code: 32, fg: rgbColor('#123456'), bg: 15 }]])
    const sauce = { ...emptySauce(), title: 'RGB art', comments: ['One'] }
    const chunks = [...tundraChunks(cells, sauce)]
    expect(chunks.at(-1)![95]).toBe(8)
    expect(await readTundraDocument(new Blob(chunks), new AbortController().signal)).toEqual({ cells, sauce })
    const wrong = chunks.at(-1)!.slice()
    wrong[95] = 1
    await expect(readTundraDocument(new Blob([...chunks.slice(0, -1), wrong]), new AbortController().signal)).rejects.toThrow('SAUCE file type')
    const controller = new AbortController()
    controller.abort()
    await expect(readTundraDocument(new Blob(chunks), controller.signal)).rejects.toHaveProperty('name', 'AbortError')
  })

  it('cancels a pending stream read and releases the reader', async () => {
    const file = new Blob([new Uint8Array(header)])
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({ cancel })
    const stub = vi.spyOn(file, 'stream').mockReturnValue(stream)
    const controller = new AbortController()
    const reading = readTundraDocument(file, controller.signal)
    setTimeout(() => controller.abort(), 0)
    await expect(reading).rejects.toHaveProperty('name', 'AbortError')
    expect(cancel).toHaveBeenCalledOnce()
    expect(stream.locked).toBe(false)
    stub.mockRestore()
  })

  it('preserves the SAUCE iCE bit for Tundra RGB across open, metadata edits, history and save', async () => {
    const cells = new Map([['0,0', { code: 219, fg: rgbColor('#123456'), bg: rgbColor('#abcdef') }]])
    const source = [...tundraChunks(cells, { ...emptySauce(), title: 'RGB art' })]
    source.at(-1)![105] = 1
    const opened = await readTundraDocument(new Blob(source), new AbortController().signal)
    expect(opened.sauce?.flags).toBe(1)
    const editor = new Editor(opened.cells, opened.sauce, 'tundra')
    const edited = { ...opened.sauce!, title: 'Edited RGB' }
    editor.setSauce(edited)
    editor.undo()
    expect(editor.sauce?.title).toBe('RGB art')
    editor.redo()
    const saved = [...tundraChunks(editor.cells, editor.sauce)]
    expect(saved.at(-1)![95]).toBe(8)
    expect(saved.at(-1)![105]).toBe(1)
    expect(await readTundraDocument(new Blob(saved), new AbortController().signal)).toEqual({ cells, sauce: edited })
    expect(() => validateSauce(edited)).toThrow(/iCE/)
    expect(() => validateSauce(edited, 'tundra')).not.toThrow()
    for (const flags of [-1, 256, 1.5, NaN]) {
      expect(() => validateSauce({ ...edited, flags }, 'tundra')).toThrow()
    }
  })
})
