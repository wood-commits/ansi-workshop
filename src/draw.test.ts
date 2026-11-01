import { describe, expect, it } from 'vitest'
import { rasterizeHalfBlockStroke, type HalfPoint } from './draw'
import { asciiChunks, ansiChunks } from './export'
import { Editor, MAX_ROW, pointFromKey } from './model'

const ink = { fg: 14, bg: 1 }
const point = (x: number, y: number, half: 0 | 1 = 0): HalfPoint => ({ x, y, half })

describe('half-block strokes', () => {
  it('interpolates square half-row pixels along a diagonal', () => {
    const cells = rasterizeHalfBlockStroke(new Map(), point(0, 0), point(4, 2), ink)
    expect([...cells]).toEqual([
      ['0,0', { code: 223, ...ink }],
      ['1,0', { code: 220, ...ink }],
      ['2,1', { code: 223, ...ink }],
      ['3,1', { code: 220, ...ink }],
      ['4,2', { code: 223, ...ink }],
    ])
    expect(rasterizeHalfBlockStroke(new Map(), point(4, 2), point(0, 0), ink)).toEqual(cells)
  })

  it('merges matching halves, retains full blocks on retracing, and replaces incompatible ink or glyphs', () => {
    const source = new Map([
      ['0,0', { code: 220, ...ink }],
      ['1,0', { code: 219, ...ink }],
      ['2,0', { code: 223, ...ink }],
      ['3,0', { code: 220, fg: 4, bg: 1 }],
      ['4,0', { code: 65, ...ink }],
      ['5,0', { code: 221, ...ink }],
      ['6,0', { code: 222, ...ink }],
    ])
    const cells = rasterizeHalfBlockStroke(source, point(0, 0), point(6, 0), ink)
    expect([...cells.values()].map(cell => cell.code)).toEqual([219, 219, 223, 223, 223, 223, 223])
    expect(source.get('0,0')?.code).toBe(220)
    const vertical = rasterizeHalfBlockStroke(new Map(), point(0, 0), point(0, 1, 1), ink)
    expect([...vertical.values()]).toEqual([{ code: 219, ...ink }, { code: 219, ...ink }])
  })

  it.each([false, true])('uses only upper/lower and merged full blocks on steep strokes (reverse=%s)', reverse => {
    const start = point(0, 0), end = point(0, 3)
    const cells = rasterizeHalfBlockStroke(new Map(), reverse ? end : start, reverse ? start : end, ink)
    expect(cells).toEqual(new Map([
      ['0,0', { code: 219, ...ink }],
      ['0,1', { code: 219, ...ink }],
      ['0,2', { code: 219, ...ink }],
      ['0,3', { code: 223, ...ink }],
    ]))
    expect([...asciiChunks(cells)].flatMap(bytes => [...bytes])).toEqual([219, 13, 10, 219, 13, 10, 219, 13, 10, 223, 13, 10])
  })

  it.each([1000000000, MAX_ROW])('keeps interpolation local and sparse at row %s', row => {
    const cells = rasterizeHalfBlockStroke(new Map(), point(78, row), point(79, row, 1), ink)
    expect([...cells]).toEqual([
      [`78,${row}`, { code: 223, ...ink }],
      [`79,${row}`, { code: 220, ...ink }],
    ])
  })

  it('rejects invalid or unrepresentable half-row coordinates explicitly', () => {
    for (const end of [
      point(80, 0),
      point(0, -1),
      point(0, 0.5),
      point(0, MAX_ROW + 1),
      point(0, MAX_ROW, 1),
    ]) {
      expect(() => rasterizeHalfBlockStroke(new Map(), point(0, 0), end, ink)).toThrow(/safe.*coordinates|precision/)
    }
  })

  it('uses one undo transaction and exports raw CP437 half/full block bytes', () => {
    const editor = new Editor()
    const cells = rasterizeHalfBlockStroke(editor.cells, point(0, 0), point(1, 0, 1), ink)
    for (const [id, cell] of cells) editor.paint(pointFromKey(id), cell)
    const second = rasterizeHalfBlockStroke(editor.cells, point(1, 0, 1), point(1, 1), ink)
    for (const [id, cell] of second) editor.paint(pointFromKey(id), cell)
    editor.commit()
    const expected = new Map(editor.cells)
    expect([...asciiChunks(editor.cells)].flatMap(bytes => [...bytes])).toEqual([223, 220, 13, 10, 32, 223, 13, 10])
    expect([...ansiChunks(cells)].flatMap(bytes => [...bytes])).toEqual([
      27, 91, 48, 109, 27, 91, 50, 74, 27, 91, 72,
      27, 91, 57, 51, 59, 52, 52, 109, 223, 220,
      27, 91, 48, 109, 13, 10, 27, 91, 48, 109,
    ])
    editor.undo()
    expect(editor.cells.size).toBe(0)
    editor.redo()
    expect(editor.cells).toEqual(expected)
  })
})
