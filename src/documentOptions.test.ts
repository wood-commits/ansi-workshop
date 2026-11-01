// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Editor, EMPTY, validPoint } from './model'
import { AnsiDecoder, readAnsiDocument } from './import'
import { ansiChunks, sgr } from './export'
import { readTundraDocument, tundraChunks } from './tundra'
import { glyphMask } from './vgaFont'
import { bucketFill } from './fill'
import { moveShape } from './move'
import { rasterizeHalfBlockStroke } from './draw'
import { executeAgentCommand } from './agentCommands'
import { rasterizePrimitive, subtractPrimitive } from './primitives'
import { rasterizeGradient } from './gradient'
import { rasterizePath } from './path'

const bytesOf = (chunks: Iterable<Uint8Array<ArrayBuffer>>) => Uint8Array.from([...chunks].flatMap(chunk => [...chunk]))
const ink = { code: 219, fg: 15, bg: 14 }

describe('document columns, iCE colors and VGA ninth pixel', () => {
  it('validates width and keeps wide sparse block/history operations document-scoped', () => {
    for (const width of [0, 513, 1.5, NaN]) expect(() => new Editor(undefined, undefined, 'ansi', width)).toThrow(/columns/)
    expect(validPoint({ x: 131, y: 1_000_000_000 }, 132)).toBe(true)
    expect(validPoint({ x: 80, y: 0 })).toBe(false)
    const editor = new Editor(undefined, undefined, 'ice', 132)
    editor.paint({ x: 131, y: 1_000_000_000 }, ink); editor.commit()
    editor.paste(editor.copy({ left: 131, right: 131, top: 1_000_000_000, bottom: 1_000_000_000 }), { x: 130, y: 0 })
    editor.commit()
    expect(editor.cell({ x: 130, y: 0 })).toEqual(ink)
    editor.undo()
    expect(editor.cell({ x: 130, y: 0 })).toEqual(EMPTY)
    expect(editor.cells.size).toBe(1)
    expect(() => editor.paint({ x: 132, y: 0 }, ink)).toThrow(/columns/)
    expect(() => new Editor(undefined, undefined, 'ansi').paint({ x: 0, y: 0 }, ink)).toThrow()
  })

  it('round-trips exact iCE SGR bytes, resets brightness, and records mode/width in SAUCE', async () => {
    expect(sgr(ink, false, 'ice')).toEqual([27, 91, 53, 59, 57, 55, 59, 52, 51, 109])
    expect(sgr({ ...ink, bg: 6 }, false, 'ice')).toEqual([27, 91, 50, 53, 59, 57, 55, 59, 52, 51, 109])
    const cells = new Map([['131,0', ink], ['0,1', { ...ink, bg: 6 }]])
    const bytes = bytesOf(ansiChunks(cells, undefined, 'ice', 132))
    expect(new DataView(bytes.slice(-128).buffer).getUint16(96, true)).toBe(132)
    expect(bytes.at(-23)! & 1).toBe(1)
    const loaded = await readAnsiDocument(new Blob([bytes]), new AbortController().signal)
    expect(loaded.cells).toEqual(cells)
    expect(loaded.width).toBe(132)
    expect(loaded.format).toBe('ice')
    const decoder = new AnsiDecoder(2, 'ice')
    decoder.write(Uint8Array.from([27, 91, 53, 59, 52, 49, 109, 65, 27, 91, 50, 53, 109, 66, 27, 91, 48, 109, 67]))
    expect(decoder.finish().get('0,0')?.bg).toBe(12)
    expect(decoder.finish().get('1,0')?.bg).toBe(4)
    expect(decoder.finish().get('0,1')?.bg).toBe(0)
    const classic = new AnsiDecoder()
    expect(() => classic.write(Uint8Array.from([27, 91, 53, 109]))).toThrow(/blink/)
    expect(() => new AnsiDecoder(80, 'ice').write(Uint8Array.from([27, 91, 54, 109]))).toThrow(/blink/)
  })

  it('uses manual options for metadata-free ANSI and honors SAUCE over those options', async () => {
    const loaded = await readAnsiDocument(new Blob([new Uint8Array([65, 66, 67])]), new AbortController().signal, 2, 'ice')
    expect(loaded.cells.get('0,1')?.code).toBe(67)
    expect(loaded.width).toBe(2)
    const tagged = bytesOf(ansiChunks(new Map([['2,0', { code: 65, fg: 7, bg: 0 }]]), undefined, 'ansi', 3))
    const automatic = await readAnsiDocument(new Blob([tagged]), new AbortController().signal, 2, 'ice')
    expect(automatic.width).toBe(3)
    expect(automatic.format).toBe('ansi')
  })

  it('imports all extended bright backgrounds only in iCE mode across byte boundaries', () => {
    const decoder = new AnsiDecoder(80, 'ice')
    const backgrounds = [8, 12, 10, 14, 9, 13, 11, 15]
    for (let index = 0; index < backgrounds.length; index++) {
      const text = `\x1b[0;30;${100 + index}m\xdb`
      for (const byte of Uint8Array.from(text, char => char.charCodeAt(0))) decoder.write(new Uint8Array([byte]))
      expect(decoder.finish().get(`${index},0`)).toEqual({ code: 219, fg: 0, bg: backgrounds[index] })
      expect(() => new AnsiDecoder().write(Uint8Array.from(text, char => char.charCodeAt(0)))).toThrow(/background/)
    }
    const exported = bytesOf(ansiChunks(decoder.finish(), undefined, 'ice'))
    const text = String.fromCharCode(...exported)
    for (const sequence of text.split('\x1b[').slice(1)) {
      expect(sequence.split('m')[0].split(';').some(value => Number(value) >= 100 && Number(value) <= 107)).toBe(false)
    }
    const loaded = new AnsiDecoder(80, 'ice')
    loaded.write(exported.slice(0, -128))
    expect(loaded.finish()).toEqual(decoder.finish())
  })

  it('keeps extended background selection separate from iCE SGR 5 intensity', () => {
    const decoder = new AnsiDecoder(80, 'ice')
    const text = '\x1b[101mA\x1b[5mB\x1b[25mC\x1b[44mD\x1b[5mE\x1b[102mF\x1b[25mG\x1b[49mH\x1b[107mI\x1b[0mJ'
    decoder.write(Uint8Array.from(text, char => char.charCodeAt(0)))
    expect([...decoder.finish().values()].map(cell => cell.bg)).toEqual([12, 12, 12, 1, 9, 10, 10, 0, 15, 0])
    expect(() => new AnsiDecoder(80, 'ice').write(Uint8Array.from('\x1b[100m\x1b[2J', char => char.charCodeAt(0))))
      .toThrow(/background/)
  })

  it('opens extended backgrounds using SAUCE iCE detection or the metadata-free mode setting', async () => {
    const content = Uint8Array.from('\x1b[0;30;100m\xdb\x1b[0;37;107m\xdb', char => char.charCodeAt(0))
    const trailer = bytesOf(ansiChunks(new Map(), undefined, 'ice', 114)).slice(-128)
    const signal = new AbortController().signal
    const automatic = await readAnsiDocument(new Blob([content, trailer]), signal)
    expect(automatic.format).toBe('ice')
    expect(automatic.width).toBe(114)
    expect(automatic.cells).toEqual(new Map([
      ['0,0', { code: 219, fg: 0, bg: 8 }],
      ['1,0', { code: 219, fg: 7, bg: 15 }],
    ]))
    const manual = await readAnsiDocument(new Blob([content]), signal, 114, 'ice')
    expect(manual.cells).toEqual(automatic.cells)
    expect(manual.format).toBe('ice')
    await expect(readAnsiDocument(new Blob([content]), signal)).rejects.toThrow(/background/)
    trailer[105] = 0
    await expect(readAnsiDocument(new Blob([content, trailer]), signal, 114, 'ice')).rejects.toThrow(/background/)
  })

  it('round-trips wider Tundra positions and wrap without dense storage', async () => {
    const cells = new Map([['131,0', ink], ['0,1', ink], ['131,1000000000', ink]])
    const bytes = bytesOf(tundraChunks(cells, undefined, 132))
    expect(bytes.length).toBeLessThan(200)
    const loaded = await readTundraDocument(new Blob([bytes]), new AbortController().signal)
    expect(loaded.cells).toEqual(cells)
    expect(loaded.width).toBe(132)
  })

  it('propagates width through connected fills, moves, and half-block strokes', () => {
    const cells = new Map([['130,0', ink], ['131,0', ink]])
    expect(bucketFill(cells, { x: 131, y: 0 }, 'shape', 3, 'ice', 132).size).toBe(2)
    expect(moveShape(cells, { x: 10, y: 0 }, 132).get('131,0')).toEqual(ink)
    expect(rasterizeHalfBlockStroke(new Map(), { x: 130, y: 0, half: 0 }, { x: 131, y: 0, half: 0 }, ink, 132).size).toBe(2)
    const primitive = rasterizePrimitive('rectangle', true, { x: 130, y: 0 }, { x: 131, y: 1 }, 0, ink, 132)
    expect(primitive.has('131,1')).toBe(true)
    expect(subtractPrimitive(cells, primitive, 132).get('131,0')).toEqual(EMPTY)
    expect(rasterizeGradient(cells, 'linear', { x: 130, y: 0 }, { x: 131, y: 0 }, ink, 'ice', 132).size).toBe(2)
    const nodes = [{ x: 130, y: 0 }, { x: 132, y: 0 }, { x: 132, y: 2 }, { x: 130, y: 2 }]
      .map(point => ({ point, incoming: point, outgoing: point }))
    expect(rasterizePath({ origin: 0, closed: true, nodes }, ink, undefined, 'ice', 132).has('131,1')).toBe(true)
    expect(executeAgentCommand(new Editor(undefined, undefined, 'ice', 132), 'doc', 0,
      { type: 'read', input: { x: 0, y: 0, width: 1, height: 1 } }).ok).toBe(false)
  })

  it('rejects unsupported SAUCE dimensions before decoding, without allocating their area', async () => {
    const bytes = bytesOf(ansiChunks(new Map(), undefined, 'ice'))
    new DataView(bytes.buffer).setUint16(bytes.length - 128 + 96, 513, true)
    await expect(readAnsiDocument(new Blob([bytes]), new AbortController().signal)).rejects.toThrow(/columns/)
  })

  it('adds a blank ninth pixel except for CP437 192-223 and scales that native mask', () => {
    for (let code = 32; code <= 255; code++) {
      const original = glyphMask(code)
      const native = glyphMask(code, 9, 16, 9)
      for (let y = 0; y < 16; y++) {
        expect([...native.slice(y * 9, y * 9 + 8)]).toEqual([...original.slice(y * 8, y * 8 + 8)])
        expect(native[y * 9 + 8]).toBe(code >= 192 && code <= 223 ? original[y * 8 + 7] : 0)
      }
      const double = glyphMask(code, 18, 32, 9)
      for (let y = 0; y < 32; y++) for (let x = 0; x < 18; x++) {
        expect(double[y * 18 + x]).toBe(native[Math.floor(y / 2) * 9 + Math.floor(x / 2)])
      }
    }
  })
})
