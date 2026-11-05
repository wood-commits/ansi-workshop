import { describe, expect, it } from 'vitest'
import { connectedShape, moveSelection, moveShape } from './move'
import { Editor, EMPTY, key, MAX_ROW, pointFromKey, type Cell } from './model'

const ink = { code: 219, fg: 14, bg: 0 }

describe('moving rectangular selections', () => {
  it('moves disconnected cells and colored spaces, erases destination blanks, and leaves adjacent outside art alone', () => {
    const source = new Map([
      ['1,1', ink], ['4,1', { code: 32, fg: 7, bg: 3 }],
      ['0,1', ink], ['6,3', ink], ['9,3', ink],
    ])
    const before = new Map(source)
    const result = moveSelection(source, { left: 1, top: 1, right: 4, bottom: 2 }, { x: 4, y: 2 })
    expect(result.selection).toEqual({ left: 5, top: 3, right: 8, bottom: 4 })
    expect(result.cells).toEqual(new Map([
      ['1,1', EMPTY], ['4,1', EMPTY], ['6,3', EMPTY],
      ['5,3', ink], ['8,3', source.get('4,1')!],
    ]))
    expect(result.cells.get('5,3')).not.toBe(source.get('1,1'))
    expect(source).toEqual(before)
  })

  it('handles self-overlap and restores source, blanks and overwritten art in one undo step', () => {
    const source = new Map([['1,1', ink], ['3,1', { code: 65, fg: 4, bg: 0 }], ['4,1', ink]])
    const editor = new Editor(source)
    const result = moveSelection(source, { left: 1, top: 1, right: 3, bottom: 1 }, { x: 1, y: 0 })
    for (const [id, cell] of result.cells) editor.paint(pointFromKey(id), cell)
    editor.commit()
    const moved = new Map([['2,1', ink], ['4,1', source.get('3,1')!]])
    expect(editor.cells).toEqual(moved)
    editor.undo()
    expect(editor.cells).toEqual(source)
    expect(editor.canUndo).toBe(false)
    editor.redo()
    expect(editor.cells).toEqual(moved)
  })

  it.each([1, 80, 132, 512])('clamps the complete selection including blank margins to width %i', width => {
    const bounds = { left: 0, top: 1, right: width - 1, bottom: 3 }
    const source = new Map([['0,2', ink]])
    const result = moveSelection(source, bounds, { x: width, y: -100 }, width)
    expect(result.selection).toEqual({ ...bounds, top: 0, bottom: 2 })
    expect(result.cells.get('0,1')).toEqual(ink)
  })

  it('keeps billion-row rectangles and maximum-row translations sparse', () => {
    const source = new Map([['1,0', ink], ['1,1000000000', ink]])
    const result = moveSelection(source, { left: 0, top: 0, right: 3, bottom: 1_000_000_000 },
      { x: 2, y: MAX_ROW })
    expect(result.selection).toEqual({ left: 2, top: MAX_ROW - 1_000_000_000, right: 5, bottom: MAX_ROW })
    expect(result.cells.size).toBe(4)
    expect(result.cells.get(key(3, MAX_ROW))).toEqual(ink)
  })

  it('moves blank selections opaquely and leaves zero-displacement gestures out of history', () => {
    const source = new Map([['5,1', ink]])
    expect(moveSelection(source, { left: 0, top: 0, right: 1, bottom: 1 }, { x: 5, y: 0 }).cells)
      .toEqual(new Map([['5,1', EMPTY]]))
    const editor = new Editor(source)
    editor.paint({ x: 10, y: 10 }, ink); editor.commit(); editor.undo()
    for (const [id, cell] of moveSelection(editor.cells, { left: 4, top: 0, right: 6, bottom: 2 }, { x: 0, y: 0 }).cells) {
      editor.paint(pointFromKey(id), cell)
    }
    editor.commit()
    expect(editor.canUndo).toBe(false)
    expect(editor.canRedo).toBe(true)
    expect(editor.dirty).toBe(false)
  })

  it('rejects invalid bounds, offsets and document coordinates before producing edits', () => {
    const bounds = { left: 0, top: 0, right: 1, bottom: 1 }
    for (const invalid of [{ ...bounds, left: -1 }, { ...bounds, right: 80 },
      { ...bounds, bottom: MAX_ROW + 1 }, { ...bounds, top: 2 }, { ...bounds, right: -1 }]) {
      expect(() => moveSelection(new Map(), invalid, { x: 0, y: 0 })).toThrow(/coordinates/)
    }
    expect(() => moveSelection(new Map(), bounds, { x: NaN, y: 0 })).toThrow(/offset/)
  })
})

describe('moving connected shapes', () => {
  it('finds side-connected art of every color and glyph, including colored spaces, but not diagonal neighbors', () => {
    const source = new Map([
      ['1,1', ink], ['2,1', { code: 223, fg: 4, bg: 2 }],
      ['2,2', { code: 32, fg: 7, bg: 3 }], ['3,3', ink], ['70,1000000000', ink],
    ])
    const region = connectedShape(source, { x: 1, y: 1 })
    expect([...region.keys()].sort()).toEqual(['1,1', '2,1', '2,2'])
    expect(region.get('2,2')).toEqual(source.get('2,2'))
    expect(region.get('1,1')).not.toBe(source.get('1,1'))
  })

  it('previews source erasure and translated cells without erasing holes or mutating the source', () => {
    const source = new Map([['1,1', ink], ['2,1', { code: 65, fg: 4, bg: 1 }], ['1,2', ink]])
    const before = new Map(source)
    const result = moveShape(connectedShape(source, { x: 1, y: 1 }), { x: 1, y: 0 })
    expect(result).toEqual(new Map([
      ['1,1', EMPTY], ['2,1', ink], ['1,2', EMPTY],
      ['3,1', source.get('2,1')!], ['2,2', ink],
    ]))
    expect(result.has('3,2')).toBe(false)
    expect(source).toEqual(before)
  })

  it('overwrites only destination shape cells, and restores overlaps and overwritten art in one undo step', () => {
    const source = new Map([['1,1', ink], ['2,1', { code: 223, fg: 4, bg: 1 }], ['5,1', { code: 66, fg: 2, bg: 0 }]])
    const editor = new Editor(source)
    for (const [id, cell] of moveShape(connectedShape(source, { x: 1, y: 1 }), { x: 3, y: 0 })) {
      editor.paint(pointFromKey(id), cell)
    }
    editor.commit()
    const moved = new Map(editor.cells)
    expect(moved).toEqual(new Map([['4,1', ink], ['5,1', source.get('2,1')!]]))
    editor.undo()
    expect(editor.cells).toEqual(source)
    expect(editor.canUndo).toBe(false)
    expect(editor.dirty).toBe(false)
    editor.redo()
    expect(editor.cells).toEqual(moved)
  })

  it('clamps the complete shape at document edges instead of clipping it', () => {
    const source = new Map([['1,1', ink], ['2,1', ink], ['2,2', ink]])
    expect(moveShape(source, { x: -40, y: -40 }).get('0,0')).toEqual(ink)
    const right = moveShape(source, { x: 100, y: 0 })
    expect(right.get('78,1')).toEqual(ink)
    expect(right.get('79,2')).toEqual(ink)
    const bottom = new Map([[key(1, MAX_ROW - 1), ink], [key(1, MAX_ROW), ink]])
    expect(moveShape(bottom, { x: 0, y: 1 })).toEqual(bottom)
  })

  it('uses sparse local offsets at billion-row and maximum coordinates', () => {
    for (const row of [1_000_000_000, MAX_ROW - 2]) {
      const source = new Map([[key(1, row), ink], [key(1, row + 1), ink]])
      const result = moveShape(connectedShape(source, { x: 1, y: row }), { x: 2, y: 1 })
      expect(result.size).toBe(4)
      expect(result.get(key(3, row + 2))).toEqual(ink)
    }
  })

  it('preserves saved identity and redo for a zero-displacement gesture', () => {
    const editor = new Editor(new Map([['1,1', ink]]))
    editor.paint({ x: 10, y: 10 }, ink); editor.commit(); editor.undo()
    for (const [id, cell] of moveShape(connectedShape(editor.cells, { x: 1, y: 1 }), { x: 0, y: 0 })) {
      editor.paint(pointFromKey(id), cell)
    }
    editor.commit()
    expect(editor.canRedo).toBe(true)
    expect(editor.canUndo).toBe(false)
    expect(editor.dirty).toBe(false)
  })

  it('rejects empty starts and unsafe coordinates or offsets before producing edits', () => {
    expect(() => connectedShape(new Map(), { x: 0, y: 0 })).toThrow(/painted cell/)
    expect(() => connectedShape(new Map(), { x: 0, y: MAX_ROW + 1 })).toThrow(/coordinates/)
    expect(() => moveShape(new Map([['0,0', ink]]), { x: NaN, y: 0 })).toThrow(/offset/)
    expect(() => moveShape(new Map([['0,0', ink]]), { x: 0, y: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/offset/)
    expect(() => moveShape(new Map<string, Cell>([[key(0, MAX_ROW + 1), ink]]), { x: 0, y: 0 })).toThrow(/coordinates/)
  })
})
