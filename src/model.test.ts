import { describe, expect, it } from 'vitest'
import { CP437, PALETTES, characterCode, flipCharacter } from './ansi'
import { Editor, EMPTY, linePoints, rectangle, validPoint } from './model'

const ink = { code: 219, fg: 14, bg: 1 }
describe('CP437 and ANSI primitives', () => {
  it('matches the classic Blocks & shading F1-F10 order, leaving F11/F12 unassigned', () => {
    expect(PALETTES[0].codes).toEqual([176, 177, 178, 219, 223, 220, 221, 222, 254, 250])
    expect(PALETTES[0].codes[10]).toBeUndefined()
    expect(PALETTES[0].codes[11]).toBeUndefined()
  })
  it('maps every printable byte without duplicate or missing extended glyphs', () => {
    expect(CP437).toHaveLength(256)
    expect(CP437[128]).toBe('Ç')
    expect(CP437[219]).toBe('█')
    expect(CP437[255]).toBe('\u00a0')
    expect(characterCode('█')).toBe(219)
    expect(characterCode('\x1b')).toBeUndefined()
    expect(characterCode('🙂')).toBeUndefined()
    const mapped = new Set(PALETTES.flatMap(palette => palette.codes))
    for (let code = 32; code <= 255; code++) expect(mapped.has(code)).toBe(true)
  })
  it('mirrors block and line glyphs symmetrically', () => {
    expect(flipCharacter(221, 'x')).toBe(222)
    expect(flipCharacter(220, 'y')).toBe(223)
    expect(flipCharacter(218, 'x')).toBe(191)
    expect(flipCharacter(218, 'y')).toBe(192)
    for (let code = 32; code <= 255; code++) {
      expect(flipCharacter(flipCharacter(code, 'x'), 'x')).toBe(code)
      expect(flipCharacter(flipCharacter(code, 'y'), 'y')).toBe(code)
    }
  })
})
describe('sparse document and history', () => {
  it('validates and copies an imported baseline without adding undo history', () => {
    const source = new Map([['1,1000000000', { ...ink }]])
    const loaded = new Editor(source)
    source.get('1,1000000000')!.code = 65
    source.clear()
    expect(loaded.cells.size).toBe(1)
    expect(loaded.cell({ x: 1, y: 1_000_000_000 })).toEqual(ink)
    expect(loaded.dirty).toBe(false)
    expect(loaded.canUndo).toBe(false)
    expect(() => new Editor(new Map([['80,0', ink]]))).toThrow('coordinates')
    expect(() => new Editor(new Map([['0,0', { ...ink, code: 27 }]]))).toThrow('Invalid cell')
  })
  it('stores a cell a billion rows down without allocating intervening rows', () => {
    const editor = new Editor()
    editor.paint({ x: 79, y: 1_000_000_000 }, ink)
    editor.commit()
    expect(editor.cells.size).toBe(1)
    expect(editor.lastRow).toBe(1_000_000_000)
    expect(editor.cell({ x: 0, y: 900_000_000 })).toEqual(EMPTY)
  })
  it('treats a stroke as one undo and restores the original cell on repeated writes', () => {
    const editor = new Editor()
    editor.paint({ x: 0, y: 0 }, ink)
    editor.paint({ x: 0, y: 0 }, { ...ink, code: 220 })
    editor.paint({ x: 1, y: 0 }, ink)
    editor.commit()
    expect(editor.canUndo).toBe(true)
    editor.undo()
    expect(editor.cells.size).toBe(0)
    expect(editor.dirty).toBe(false)
    editor.redo()
    expect(editor.cell({ x: 0, y: 0 }).code).toBe(220)
    expect(editor.cells.size).toBe(2)
  })
  it('tracks saved identity across undo/redo and branched histories', () => {
    const editor = new Editor()
    editor.paint({ x: 0, y: 0 }, ink); editor.commit(); editor.markSaved()
    expect(editor.dirty).toBe(false)
    editor.paint({ x: 1, y: 0 }, ink); editor.commit()
    editor.undo()
    expect(editor.dirty).toBe(false)
    editor.undo()
    editor.paint({ x: 2, y: 0 }, ink); editor.commit()
    expect(editor.dirty).toBe(true)
    expect(editor.canRedo).toBe(false)
  })
  it('does not mark concurrent changes saved when saving an earlier snapshot', () => {
    const editor = new Editor()
    editor.paint({ x: 0, y: 0 }, ink); editor.commit()
    const snapshotVersion = editor.version
    editor.paint({ x: 1, y: 0 }, ink); editor.commit()
    editor.markSaved(snapshotVersion)
    expect(editor.dirty).toBe(true)
    editor.undo()
    expect(editor.dirty).toBe(false)
  })
  it('ignores net-zero transactions and removes default blank cells', () => {
    const editor = new Editor()
    editor.paint({ x: 0, y: 0 }, ink)
    editor.paint({ x: 0, y: 0 }, EMPTY)
    editor.commit()
    expect(editor.canUndo).toBe(false)
    expect(editor.cells.size).toBe(0)
  })
  it('rejects control bytes, invalid colors and unsafe coordinates', () => {
    const editor = new Editor()
    for (const code of [0, 10, 13, 27, 31, 256, NaN, 32.5]) {
      expect(() => editor.paint({ x: 0, y: 0 }, { ...ink, code })).toThrow()
    }
    for (const value of [-1, 16, Infinity, 1.5]) {
      expect(() => editor.paint({ x: 0, y: 0 }, { ...ink, fg: value })).toThrow()
      expect(() => editor.paint({ x: 0, y: 0 }, { ...ink, bg: value })).toThrow()
    }
    for (let bg = 8; bg <= 15; bg++) {
      expect(() => editor.paint({ x: 0, y: 0 }, { ...ink, bg })).toThrow()
    }
    for (const point of [{ x: 80, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: Infinity }, { x: 0, y: Number.MAX_SAFE_INTEGER }]) {
      expect(validPoint(point)).toBe(false)
      expect(() => editor.paint(point, ink)).toThrow()
    }
  })
})
describe('block operations', () => {
  it('copies sparsely, pastes blanks opaquely, clips at column 80, and undoes', () => {
    const editor = new Editor()
    editor.paint({ x: 0, y: 0 }, ink)
    editor.paint({ x: 2, y: 0 }, { ...ink, code: 220 })
    editor.paint({ x: 79, y: 1 }, ink)
    editor.commit()
    const block = editor.copy({ left: 0, right: 2, top: 0, bottom: 0 })
    expect(block.width).toBe(3)
    expect(block.cells.size).toBe(2)
    editor.paste(block, { x: 78, y: 1 }); editor.commit()
    expect(editor.cell({ x: 78, y: 1 })).toEqual(ink)
    expect(editor.cell({ x: 79, y: 1 })).toEqual(EMPTY)
    editor.undo()
    expect(editor.cell({ x: 79, y: 1 })).toEqual(ink)
    expect(editor.cell({ x: 78, y: 1 })).toEqual(EMPTY)
  })
  it('mirrors position, character, and color in both directions', () => {
    const editor = new Editor()
    editor.paint({ x: 1, y: 1 }, { ...ink, code: 218 }); editor.commit()
    const rect = { left: 1, top: 1, right: 3, bottom: 3 }
    editor.flip(rect, 'x'); editor.commit()
    expect(editor.cell({ x: 3, y: 1 })).toEqual({ ...ink, code: 191 })
    editor.flip(rect, 'y'); editor.commit()
    expect(editor.cell({ x: 3, y: 3 })).toEqual({ ...ink, code: 217 })
    editor.undo(); editor.undo()
    expect(editor.cell({ x: 1, y: 1 }).code).toBe(218)
  })
  it('clears and copies an enormous selection without dense allocation', () => {
    const editor = new Editor()
    editor.paint({ x: 0, y: 1_000_000_000 }, ink); editor.commit()
    const rect = rectangle({ x: 79, y: 1_000_000_000 }, { x: 0, y: 0 })
    const block = editor.copy(rect)
    expect(block.height).toBe(1_000_000_001)
    expect(block.cells.size).toBe(1)
    editor.clear(rect); editor.commit()
    expect(editor.cells.size).toBe(0)
    editor.undo()
    expect(editor.cells.size).toBe(1)
  })
  it('rejects paste overflow before modifying existing cells', () => {
    const editor = new Editor()
    expect(() => editor.paste({ width: 1, height: 100, cells: new Map() }, { x: 0, y: Number.MAX_SAFE_INTEGER - 50 })).toThrow()
  })
  it('interpolates strokes without holes, including reverse and single-point lines', () => {
    const points = linePoints({ x: 0, y: 0 }, { x: 7, y: 4 })
    expect(points).toHaveLength(8)
    expect(points.at(-1)).toEqual({ x: 7, y: 4 })
    expect(linePoints({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([{ x: 3, y: 3 }])
    expect(linePoints({ x: 7, y: 4 }, { x: 0, y: 0 }).at(-1)).toEqual({ x: 0, y: 0 })
  })
})
