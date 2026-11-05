import { describe, expect, it } from 'vitest'
import { CP437, PALETTES, characterCode, flipCharacter } from './ansi'
import { rgbColor } from './colors'
import { Editor, EMPTY, key, MAX_ROW, linePoints, rectangle, validPoint } from './model'

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
  it('inserts before the cursor, shifting only that row and preserving holes, inks and colored spaces', () => {
    const source = new Map([
      ['0,2', { ...ink, code: 65 }], ['1,2', { ...ink, code: 66 }],
      ['3,2', { code: 32, fg: 3, bg: 1 }], ['79,3', ink], ['10,1000000000', ink],
    ])
    const editor = new Editor(source)
    editor.insert({ x: 1, y: 2 }, ink); editor.commit()
    const expected = new Map([
      ['0,2', source.get('0,2')!], ['1,2', ink], ['2,2', source.get('1,2')!],
      ['4,2', source.get('3,2')!], ['79,3', ink], ['10,1000000000', ink],
    ])
    expect(editor.cells).toEqual(expected)
    editor.undo()
    expect(editor.cells).toEqual(source)
    expect(editor.canUndo).toBe(false)
    expect(editor.dirty).toBe(false)
    editor.redo()
    expect(editor.cells).toEqual(expected)
  })
  it.each([1, 80, 132, 512])('inserts at the right edge of width %i without wrapping or losing artwork', width => {
    const editor = new Editor(undefined, undefined, 'ansi', width)
    const point = { x: width - 1, y: MAX_ROW }
    editor.insert(point, ink); editor.commit()
    const before = new Map(editor.cells)
    expect(() => editor.insert(point, { ...ink, code: 65 })).toThrow(/discard artwork/)
    expect(editor.cells).toEqual(before)
    editor.undo()
    expect(editor.cells.size).toBe(0)
  })
  it.each([ink, { code: 32, fg: 7, bg: 1 }])('refuses insertion before any shifts if the last column contains %o', tail => {
    const source = new Map([['0,0', ink], ['79,0', tail]])
    const editor = new Editor(source)
    editor.paint({ x: 1, y: 1 }, ink); editor.commit(); editor.undo()
    const version = editor.version
    expect(() => editor.insert({ x: 0, y: 0 }, { ...ink, code: 65 })).toThrow(/discard artwork/)
    expect(editor.cells).toEqual(source)
    expect(editor.version).toBe(version)
    expect(editor.dirty).toBe(false)
    expect(editor.canRedo).toBe(true)
  })
  it.each(['ice', 'tundra'] as const)('preserves %s inks when inserting at distant rows', format => {
    const cell = { code: 218, fg: format === 'ice' ? 15 : rgbColor('#123456'),
      bg: format === 'ice' ? 14 : rgbColor('#654321') }
    const source = new Map([[key(130, MAX_ROW), cell]])
    const editor = new Editor(source, undefined, format, 132)
    editor.insert({ x: 129, y: MAX_ROW }, { ...cell, code: 65 }); editor.commit()
    expect(editor.cell({ x: 131, y: MAX_ROW })).toEqual(cell)
    expect(editor.cell({ x: 129, y: MAX_ROW }).code).toBe(65)
    expect(editor.cell({ x: 130, y: MAX_ROW })).toEqual(EMPTY)
  })
  it('validates inserted values and coordinates before changing any cells', () => {
    const source = new Map([['1,0', ink]])
    const editor = new Editor(source)
    expect(() => editor.insert({ x: 0, y: 0 }, { ...ink, code: 27 })).toThrow(/Invalid cell/)
    expect(() => editor.insert({ x: 0, y: 0 }, { ...ink, bg: 8 })).toThrow(/Invalid cell/)
    expect(() => editor.insert({ x: -1, y: 0 }, ink)).toThrow(/coordinates/)
    expect(editor.cells).toEqual(source)
    expect(editor.canUndo).toBe(false)
  })
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
  it.each([
    { direction: 'above', first: '2,1', second: '3,0', blank: '2,0', corner: 192, half: 221 },
    { direction: 'below', first: '2,5', second: '3,4', blank: '2,4', corner: 192, half: 221 },
    { direction: 'left', first: '1,2', second: '0,3', blank: '1,3', corner: 191, half: 222 },
    { direction: 'right', first: '5,2', second: '4,3', blank: '5,3', corner: 191, half: 222 },
  ] as const)('adds an opaque reflected copy $direction without changing the original, in one undo step', ({ direction, first, second, blank, corner, half }) => {
    const source = new Map([
      ['2,2', { ...ink, code: 218 }], ['3,3', { ...ink, code: 221 }],
      [blank, { code: 65, fg: 7, bg: 0 }], ['70,1000000000', ink],
    ])
    const editor = new Editor(source)
    const result = editor.mirror({ left: 2, top: 2, right: 3, bottom: 3 }, direction)
    editor.commit()
    expect(result.clipped).toBe(false)
    const expected = new Map(source)
    expected.delete(blank)
    expected.set(first, { ...ink, code: corner }); expected.set(second, { ...ink, code: half })
    expect(editor.cells).toEqual(expected)
    editor.undo()
    expect(editor.cells).toEqual(source)
    expect(editor.dirty).toBe(false)
    expect(editor.canUndo).toBe(false)
    editor.redo()
    expect(editor.cells).toEqual(expected)
  })
  it.each(['above', 'left', 'right'] as const)('clips a reflected copy at the %s edge and preserves colored spaces', direction => {
    const source = new Map([
      ['1,1', { code: 32, fg: 3, bg: 1 }], ['3,3', { ...ink, code: 218 }],
    ])
    const editor = new Editor(source, undefined, 'ansi', 5)
    const result = editor.mirror({ left: 1, top: 1, right: 3, bottom: 3 }, direction)
    editor.commit()
    expect(result.clipped).toBe(true)
    if (direction === 'above') expect(editor.cell({ x: 1, y: 0 })).toEqual(source.get('1,1'))
    if (direction === 'left') expect(editor.cell({ x: 0, y: 1 })).toEqual(source.get('1,1'))
    if (direction === 'right') expect(editor.cell({ x: 4, y: 3 })).toEqual({ ...ink, code: 191 })
    expect(editor.cells.get('1,1')).toEqual(source.get('1,1'))
    expect(editor.cells.get('3,3')).toEqual(source.get('3,3'))
  })
  it('mirrors billion-row rectangles sparsely and clips safely without overflowing maximum rows', () => {
    const editor = new Editor(new Map([['1,0', ink], ['2,1000000000', { ...ink, code: 220 }]]))
    editor.mirror({ left: 1, top: 0, right: 2, bottom: 1_000_000_000 }, 'below'); editor.commit()
    expect(editor.cells.size).toBe(4)
    expect(editor.cell({ x: 1, y: 2_000_000_001 })).toEqual(ink)
    expect(editor.cell({ x: 2, y: 1_000_000_001 }).code).toBe(223)
    const source = new Map([['0,0', ink], [key(1, MAX_ROW - 1), { ...ink, code: 220 }]])
    const maximum = new Editor(source)
    const result = maximum.mirror({ left: 0, top: 0, right: 1, bottom: MAX_ROW - 1 }, 'below')
    maximum.commit()
    expect(result.clipped).toBe(true)
    expect(maximum.cells.size).toBe(3)
    expect(maximum.cell({ x: 1, y: MAX_ROW }).code).toBe(223)
    maximum.undo()
    expect(maximum.cells).toEqual(source)
  })
  it.each(['ice', 'tundra'] as const)('preserves %s inks when mirroring wide documents', format => {
    const width = format === 'ice' ? 132 : 512
    const colors = format === 'ice' ? { fg: 15, bg: 14 }
      : { fg: rgbColor('#0c2238'), bg: rgbColor('#4e5a7b') }
    const cell = { code: 218, ...colors }
    const editor = new Editor(new Map([[key(width - 4, 2), cell]]), undefined, format, width)
    editor.mirror({ left: width - 4, right: width - 3, top: 2, bottom: 2 }, 'right'); editor.commit()
    expect(editor.cell({ x: width - 4, y: 2 })).toEqual(cell)
    expect(editor.cell({ x: width - 1, y: 2 })).toEqual({ ...cell, code: 191 })
  })
  it('reports no available space or invalid bounds without changing art, saved identity or redo', () => {
    const editor = new Editor(new Map([['0,0', ink]]))
    editor.paint({ x: 1, y: 0 }, ink); editor.commit(); editor.undo()
    const source = new Map(editor.cells)
    const bounds = { left: 0, top: 0, right: 79, bottom: MAX_ROW }
    for (const direction of ['above', 'below', 'left', 'right'] as const) {
      expect(() => editor.mirror(bounds, direction)).toThrow(/room/)
    }
    for (const invalid of [{ ...bounds, left: -1 }, { ...bounds, bottom: MAX_ROW + 1 }, { ...bounds, right: 80 }]) {
      expect(() => editor.mirror(invalid, 'right')).toThrow(/coordinates/)
    }
    expect(editor.cells).toEqual(source)
    expect(editor.canRedo).toBe(true)
    expect(editor.dirty).toBe(false)
  })
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
