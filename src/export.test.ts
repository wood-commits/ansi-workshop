import { describe, expect, it } from 'vitest'
import { ansiChunks, asciiChunks } from './export'
import { Editor, key } from './model'

function bytes(editor: Editor): number[] { return [...ansiChunks(editor.cells)].flatMap(chunk => [...chunk]) }
function asLatin1(value: number[]): string { return value.map(byte => String.fromCharCode(byte)).join('') }
describe('ASCII byte export', () => {
  it('preserves every CP437 byte without ANSI codes or UTF-8 encoding', () => {
    const editor = new Editor()
    for (let code = 32; code <= 255; code++) {
      const index = code - 32
      editor.paint({ x: index % 80, y: Math.floor(index / 80) }, { code, fg: 14, bg: 1 })
    }
    const output = [...asciiChunks(editor.cells)].flatMap(chunk => [...chunk])
    expect(output).toEqual([
      ...Array.from({ length: 80 }, (_, i) => i + 32), 13, 10,
      ...Array.from({ length: 80 }, (_, i) => i + 112), 13, 10,
      ...Array.from({ length: 64 }, (_, i) => i + 192), 13, 10,
    ])
    expect(output).not.toContain(27)
  })
  it('preserves leading blanks, colored spaces, full-width rows and sparse gaps in row order', () => {
    const editor = new Editor()
    editor.paint({ x: 79, y: 2 }, { code: 32, fg: 7, bg: 1 })
    editor.paint({ x: 2, y: 0 }, { code: 219, fg: 14, bg: 4 })
    expect([...asciiChunks(editor.cells)].flatMap(chunk => [...chunk])).toEqual([
      32, 32, 219, 13, 10, 13, 10, ...Array<number>(80).fill(32), 13, 10,
    ])
  })
  it('streams billion-row gaps with bounded chunks', () => {
    const iterator = asciiChunks(new Map([[key(0, 1_000_000_000), { code: 65, fg: 7, bg: 0 }]]))
    for (let i = 0; i < 10; i++) expect(iterator.next().value).toHaveLength(4096)
    iterator.return(undefined)
  })
  it('exports an empty document as an empty file', () => {
    expect([...asciiChunks(new Editor().cells)]).toEqual([])
  })
})
describe('ANSI byte export', () => {
  it('emits raw CP437 bytes, not UTF-8 glyphs', () => {
    const editor = new Editor()
    editor.paint({ x: 0, y: 0 }, { code: 219, fg: 7, bg: 0 }); editor.commit()
    const output = bytes(editor)
    expect(output).toContain(219)
    expect(output).not.toContain(226)
    expect(asLatin1(output)).toBe('\x1b[0m\x1b[2J\x1b[HÛ\x1b[0m\r\n\x1b[0m')
  })
  it('maps DOS palette order to ANSI SGR, keeping backgrounds in the classic range', () => {
    const editor = new Editor()
    editor.paint({ x: 0, y: 0 }, { code: 65, fg: 1, bg: 4 })
    editor.paint({ x: 1, y: 0 }, { code: 66, fg: 14, bg: 1 })
    expect(asLatin1(bytes(editor))).toContain('\x1b[34;41mA\x1b[93;44mB')
  })
  it('emits all 16 foreground colors and only SGR 40-47 backgrounds', () => {
    const editor = new Editor()
    const order = [0, 4, 2, 6, 1, 5, 3, 7]
    for (let fg = 0; fg < 16; fg++) {
      editor.paint({ x: fg, y: 0 }, { code: 65, fg, bg: fg % 8 })
    }
    const output = asLatin1(bytes(editor))
    for (let fg = 0; fg < 16; fg++) {
      expect(output).toContain(`\x1b[${(fg < 8 ? 30 : 90) + order[fg % 8]};${40 + order[fg % 8]}mA`)
    }
    expect(output).not.toMatch(/\[[0-9;]*10[0-7]m/)
  })
  it('preserves leading blanks, background-only cells, full-width rows and gaps', () => {
    const editor = new Editor()
    editor.paint({ x: 79, y: 2 }, { code: 32, fg: 7, bg: 1 })
    const output = asLatin1(bytes(editor))
    expect(output).toBe(`\x1b[0m\x1b[2J\x1b[H\r\n\r\n${' '.repeat(79)}\x1b[37;44m \x1b[0m\r\n\x1b[0m`)
  })
  it('resets background before blank rows to prevent color leakage', () => {
    const editor = new Editor()
    editor.paint({ x: 0, y: 0 }, { code: 219, fg: 7, bg: 4 })
    editor.paint({ x: 0, y: 2 }, { code: 65, fg: 7, bg: 0 })
    expect(asLatin1(bytes(editor))).toContain('Û\x1b[0m\r\n\r\nA')
  })
  it('starts streaming billion-row gaps using chunks no larger than 4096 bytes', () => {
    const iterator = ansiChunks(new Map([[key(0, 1_000_000_000), { code: 65, fg: 7, bg: 0 }]]))
    expect(iterator.next().value).toHaveLength(11)
    for (let i = 0; i < 10; i++) expect(iterator.next().value).toHaveLength(4096)
    iterator.return(undefined)
  })
  it('exports an empty document as a valid reset and clear sequence', () => {
    expect(asLatin1(bytes(new Editor()))).toBe('\x1b[0m\x1b[2J\x1b[H\x1b[0m')
  })
})
