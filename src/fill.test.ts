import { describe, expect, it } from 'vitest'
import { bucketFill } from './fill'
import { ansiChunks } from './export'
import { Editor, key, MAX_ROW, pointFromKey, type Cell } from './model'

const wall = { code: 219, fg: 7, bg: 0 }
function outline(left: number, top: number, right: number, bottom: number) {
  const cells = new Map<string, Cell>()
  for (let x = left; x <= right; x++) {
    cells.set(key(x, top), { ...wall })
    cells.set(key(x, bottom), { ...wall })
  }
  for (let y = top + 1; y < bottom; y++) {
    cells.set(key(left, y), { ...wall })
    cells.set(key(right, y), { ...wall })
  }
  return cells
}

describe('paint bucket', () => {
  it('recolors matching connected blocks, makes shades solid, and preserves half-block edges and backgrounds', () => {
    const cells = new Map([219, 176, 177, 178, 223, 220, 221, 222].map((code, x) => [key(x, 0), { code, fg: 7, bg: 2 }]))
    cells.set('8,0', { code: 219, fg: 6, bg: 2 })
    cells.set('0,1', { code: 219, fg: 7, bg: 3 })
    const result = bucketFill(cells, { x: 0, y: 0 }, 'shape', 14)
    expect(result.size).toBe(8)
    for (let x = 0; x < 8; x++) {
      expect(result.get(key(x, 0))).toEqual({ code: x < 4 ? 219 : cells.get(key(x, 0))!.code, fg: 14, bg: 2 })
    }
    expect(cells.get('0,0')!.fg).toBe(7)
    expect(result.has('8,0')).toBe(false)
    expect(result.has('0,1')).toBe(false)
  })

  it('retains exact glyph matching for text and preserves colored spaces', () => {
    const cells = new Map([
      ['0,0', { code: 65, fg: 7, bg: 0 }], ['1,0', { code: 65, fg: 7, bg: 0 }],
      ['2,0', { code: 66, fg: 7, bg: 0 }], ['0,1', { code: 32, fg: 7, bg: 2 }],
    ])
    const result = bucketFill(cells, { x: 0, y: 0 }, 'shape', 4)
    expect([...result.values()]).toEqual([{ code: 65, fg: 4, bg: 0 }, { code: 65, fg: 4, bg: 0 }])
    expect(cells.get('0,1')).toEqual({ code: 32, fg: 7, bg: 2 })
  })

  it('fills only enclosed default blank cells with foreground-colored full blocks', () => {
    const cells = outline(2, 2, 6, 6)
    cells.set('4,4', { code: 32, fg: 7, bg: 2 })
    const result = bucketFill(cells, { x: 3, y: 3 }, 'enclosed', 14)
    expect(result.size).toBe(8)
    expect([...result.values()].every(cell => cell.code === 219 && cell.fg === 14 && cell.bg === 0)).toBe(true)
    expect(result.has('4,4')).toBe(false)
    expect(result.has('2,2')).toBe(false)
    expect(cells.size).toBe(17)
  })

  it('does not cross walls or diagonal-only connections between blank cells', () => {
    const cells = outline(1, 1, 7, 7)
    for (let y = 2; y < 7; y++) cells.set(key(4, y), wall)
    expect(bucketFill(cells, { x: 2, y: 2 }, 'enclosed', 3).size).toBe(10)
    const diagonal = new Map<string, Cell>()
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) diagonal.set(key(x, y), wall)
    diagonal.delete('1,1'); diagonal.delete('2,2')
    expect([...bucketFill(diagonal, { x: 1, y: 1 }, 'enclosed', 3).keys()]).toEqual(['1,1'])
  })

  it('rejects open outlines, the outside area, and a completely blank document before editing', () => {
    const cells = outline(1, 1, 5, 5)
    cells.delete('3,1')
    expect(() => bucketFill(cells, { x: 3, y: 3 }, 'enclosed', 14)).toThrow(/not enclosed/)
    expect(() => bucketFill(cells, { x: 79, y: 3 }, 'enclosed', 14)).toThrow(/not enclosed/)
    expect(() => bucketFill(new Map(), { x: 40, y: 1_000_000_000 }, 'enclosed', 14)).toThrow(/not enclosed/)
    expect(cells.size).toBe(15)
  })

  it('detects an escape across a billion-row gap without scanning the gap', () => {
    const cells = new Map<string, Cell>([
      ['39,1000000000', wall], ['41,1000000000', wall], ['40,1000000001', wall],
      ['40,0', wall],
    ])
    expect(() => bucketFill(cells, { x: 40, y: 1_000_000_000 }, 'enclosed', 14)).toThrow(/not enclosed/)
    expect(cells.size).toBe(4)
  })

  it('fills small enclosures at billion-row and maximum safe coordinates without touching distant art', () => {
    for (const top of [1_000_000_000, MAX_ROW - 4]) {
      const cells = outline(2, top, 6, top + 4)
      cells.set('79,0', { code: 65, fg: 4, bg: 1 })
      const result = bucketFill(cells, { x: 3, y: top + 1 }, 'enclosed', 15)
      expect(result.size).toBe(9)
      expect(result.get(key(3, top + 1))).toEqual({ code: 219, fg: 15, bg: 0 })
      expect(result.has('79,0')).toBe(false)
    }
  })

  it('matches a reference four-connected flood fill for irregular enclosed regions', () => {
    let seed = 12345
    for (let example = 0; example < 25; example++) {
      const cells = outline(0, 0, 9, 9)
      for (let y = 1; y < 9; y++) for (let x = 1; x < 9; x++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        if ((seed >>> 16) % 4 === 0) cells.set(key(x, y), wall)
      }
      cells.delete('2,2')
      const expected = new Set<string>(), queue = [{ x: 2, y: 2 }]
      for (let i = 0; i < queue.length; i++) {
        const { x, y } = queue[i], id = key(x, y)
        if (cells.has(id) || expected.has(id)) continue
        expected.add(id)
        queue.push({ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 })
      }
      expect([...bucketFill(cells, { x: 2, y: 2 }, 'enclosed', 9).keys()].sort()).toEqual([...expected].sort())
    }
  })

  it('commits a complete fill as one undo step and preserves redo on a net-zero recolor', () => {
    const editor = new Editor(outline(1, 1, 5, 5)), before = new Map(editor.cells)
    const result = bucketFill(editor.cells, { x: 2, y: 2 }, 'enclosed', 12)
    for (const [id, cell] of result) editor.paint(pointFromKey(id), cell)
    editor.commit()
    const filled = new Map(editor.cells)
    editor.undo()
    expect(editor.cells).toEqual(before)
    for (const [id, cell] of bucketFill(editor.cells, { x: 1, y: 1 }, 'shape', 7)) editor.paint(pointFromKey(id), cell)
    editor.commit()
    expect(editor.canRedo).toBe(true)
    editor.redo()
    expect(editor.cells).toEqual(filled)
  })

  it('rejects invalid colors/coordinates and wrong target types explicitly', () => {
    const cells = outline(1, 1, 5, 5)
    expect(() => bucketFill(cells, { x: 1, y: 1 }, 'shape', 16)).toThrow(/foreground/)
    expect(() => bucketFill(cells, { x: 1, y: 1 }, 'shape', NaN)).toThrow(/foreground/)
    expect(() => bucketFill(cells, { x: -1, y: 0 }, 'enclosed', 7)).toThrow(/coordinates/)
    expect(() => bucketFill(cells, { x: 0, y: MAX_ROW + 1 }, 'shape', 7)).toThrow(/coordinates/)
    expect(() => bucketFill(cells, { x: 1, y: 1 }, 'enclosed', 7)).toThrow(/blank cell/)
    expect(() => bucketFill(cells, { x: 2, y: 2 }, 'shape', 7)).toThrow(/painted cell/)
  })

  it('exports a bright fill as CP437 full blocks without bright backgrounds', () => {
    const cells = bucketFill(outline(0, 0, 2, 2), { x: 1, y: 1 }, 'enclosed', 14)
    expect([...ansiChunks(cells)].flatMap(chunk => [...chunk])).toEqual([
      27, 91, 48, 109, 27, 91, 50, 74, 27, 91, 72, 13, 10, 32,
      27, 91, 57, 51, 59, 52, 48, 109, 219,
      27, 91, 48, 109, 13, 10, 27, 91, 48, 109,
    ])
  })
})
