import { describe, expect, it } from 'vitest'
import { connectedShape, moveShape } from './move'
import { Editor, EMPTY, key, MAX_ROW, pointFromKey, type Cell } from './model'

const ink = { code: 219, fg: 14, bg: 0 }

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
