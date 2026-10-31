import { describe, expect, it } from 'vitest'
import { Editor, key, MAX_ROW, pointFromKey, type Cell } from './model'
import { gradientRegion, rasterizeGradient } from './gradient'
import { ansiChunks } from './export'

const source = { code: 219, fg: 7, bg: 0 }
const ink = { fg: 14, bg: 1 }
function rectangle(width: number, height: number, row = 0) {
  const cells = new Map<string, Cell>()
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells.set(key(x, row + y), { ...source })
  return cells
}

describe('gradients', () => {
  it('finds only four-connected stored cells with matching glyph families and colors', () => {
    const cells = new Map([
      ['0,0', source], ['1,0', source], ['1,1', source],
      ['2,2', source], ['3,0', source],
      ['0,1', { ...source, fg: 6 }], ['2,0', { ...source, bg: 1 }],
      ['1,2', { ...source, code: 65 }],
    ])
    expect([...gradientRegion(cells, { x: 0, y: 0 }).keys()].sort()).toEqual(['0,0', '1,0', '1,1'])
    expect(() => gradientRegion(cells, { x: 79, y: 0 })).toThrow(/painted cell/)
    expect(cells.size).toBe(8)
  })

  it('includes full, half, and shading blocks with matching colors, even when starting on a half block', () => {
    const cells = new Map([219, 223, 220, 221, 222, 176, 177, 178].map((code, x) => [key(x, 0), { ...source, code }]))
    cells.set('8,0', { ...source, code: 65 })
    cells.set('0,1', { ...source, code: 223, fg: 6 })
    cells.set('1,1', { ...source, code: 220, bg: 1 })
    const region = gradientRegion(cells, { x: 1, y: 0 })
    expect(region.size).toBe(8)
    for (let x = 0; x < 8; x++) expect(region.get(key(x, 0))).toEqual(cells.get(key(x, 0)))
    expect(region.has('8,0')).toBe(false)
    expect(region.has('0,1')).toBe(false)
    expect(region.has('1,1')).toBe(false)
    expect(gradientRegion(cells, { x: 8, y: 0 }).size).toBe(1)
  })

  it.each([220, 221, 222, 223])('recolors half block %i without changing its silhouette or outside background', code => {
    const cells = rectangle(9, 2)
    for (let x = 0; x < 9; x++) cells.set(key(x, 0), { ...source, code })
    const region = gradientRegion(cells, { x: 2, y: 0 })
    expect(region.size).toBe(18)
    for (const kind of ['linear', 'radial'] as const) {
      const result = rasterizeGradient(region, kind, { x: 2, y: 0 }, { x: 6, y: 0 }, ink)
      expect(result.get('0,0')).toEqual({ code, fg: kind === 'linear' ? ink.fg : ink.bg, bg: source.bg })
      expect(result.get('2,0')).toEqual({ code, fg: ink.fg, bg: source.bg })
      expect(result.get('3,0')).toEqual({ code, fg: ink.fg, bg: source.bg })
      expect(result.get('5,0')).toEqual({ code, fg: ink.bg, bg: source.bg })
      expect(result.get('8,0')).toEqual({ code, fg: ink.bg, bg: source.bg })
      for (let x = 0; x < 9; x++) expect(result.get(key(x, 0))).toMatchObject({ code, bg: source.bg })
    }
    expect(cells.get('8,0')).toEqual({ ...source, code })
  })

  it('extends linear endpoint colors through the whole region using foreground-colored solids', () => {
    const cells = rectangle(21, 5)
    const result = rasterizeGradient(cells, 'linear', { x: 5, y: 2 }, { x: 15, y: 2 }, ink)
    expect(result.size).toBe(cells.size)
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x <= 5; x++) expect(result.get(key(x, y))).toEqual({ code: 219, ...ink })
      for (let x = 15; x < 21; x++) expect(result.get(key(x, y))).toEqual({ code: 219, fg: ink.bg, bg: ink.bg })
    }
    const reverse = rasterizeGradient(cells, 'linear', { x: 15, y: 2 }, { x: 5, y: 2 }, ink)
    expect(reverse.get('0,0')).toEqual({ code: 219, fg: ink.bg, bg: ink.bg })
    expect(reverse.get('20,0')).toEqual({ code: 219, ...ink })
    expect(cells.get('20,0')).toEqual(source)
  })

  it('staggers intermediate shade levels deterministically without adding glyphs or bright backgrounds', () => {
    const cells = rectangle(21, 16)
    const result = rasterizeGradient(cells, 'linear', { x: 0, y: 0 }, { x: 20, y: 0 }, ink)
    expect(rasterizeGradient(cells, 'linear', { x: 0, y: 0 }, { x: 20, y: 0 }, ink)).toEqual(result)
    expect(new Set([...result.values()].map(cell => cell.code))).toEqual(new Set([176, 177, 178, 219]))
    expect(new Set(Array.from({ length: 16 }, (_, y) => result.get(key(7, y))!.code)).size).toBe(2)
    for (const cell of result.values()) {
      expect(cell.bg).toBe(1)
      expect([ink.fg, ink.bg]).toContain(cell.fg)
    }
    const coverage = (cell: Cell) => cell.code === 219 ? Number(cell.fg === ink.fg) : (cell.code - 175) / 4
    for (let x = 0; x < 20; x += 4) {
      const patch = Array.from({ length: 16 }, (_, i) => coverage(result.get(key(x + i % 4, Math.floor(i / 4)))!))
      const mean = patch.reduce((a, b) => a + b) / patch.length
      expect(Math.abs(mean - (1 - (x + 1.5) / 20))).toBeLessThanOrEqual(1 / 32)
    }
  })

  it('uses VGA proportions for radial radius and linear diagonal projection', () => {
    const cells = rectangle(15, 8)
    const radial = rasterizeGradient(cells, 'radial', { x: 6, y: 3 }, { x: 10, y: 3 }, ink)
    expect(radial.get('6,3')).toEqual({ code: 219, ...ink })
    for (const id of ['2,3', '10,3', '6,1', '6,5', '14,7']) {
      expect(radial.get(id)).toEqual({ code: 219, fg: ink.bg, bg: ink.bg })
    }
    const diagonal = rasterizeGradient(cells, 'linear', { x: 2, y: 2 }, { x: 6, y: 4 }, ink)
    expect(diagonal.get('6,2')!.code).toBe(177)
    expect(diagonal.get('2,4')!.code).toBe(177)
  })

  it('stays sparse at distant rows and commits as one undoable operation', () => {
    const row = 1_000_000_000
    const editor = new Editor(rectangle(12, 3, row))
    const before = new Map(editor.cells)
    const result = rasterizeGradient(gradientRegion(editor.cells, { x: 0, y: row }), 'linear',
      { x: 2, y: row }, { x: 9, y: row }, ink)
    expect(result.size).toBe(36)
    for (const [id, cell] of result) editor.paint(pointFromKey(id), cell)
    editor.commit()
    editor.undo()
    expect(editor.cells).toEqual(before)
    expect(editor.dirty).toBe(false)
    editor.redo()
    expect(editor.cells).toEqual(result)
  })

  it('handles zero length without editing and rejects invalid coordinates and colors', () => {
    const cells = rectangle(3, 3)
    expect(rasterizeGradient(cells, 'linear', { x: 0, y: 0 }, { x: 0, y: 0 }, ink).size).toBe(0)
    expect(() => gradientRegion(cells, { x: -1, y: 0 })).toThrow(/coordinates/)
    expect(() => rasterizeGradient(cells, 'radial', { x: 0, y: 0 }, { x: 1, y: MAX_ROW + 1 }, ink)).toThrow(/coordinates/)
    expect(() => rasterizeGradient(cells, 'linear', { x: 0, y: 0 }, { x: 1, y: 0 }, { fg: 14, bg: 9 })).toThrow(/colors/)
  })

  it('exports exact CP437 shade bytes and foreground-colored endpoint solids', () => {
    const cells = rasterizeGradient(rectangle(5, 1), 'linear', { x: 0, y: 0 }, { x: 4, y: 0 }, ink)
    expect([...ansiChunks(cells)].flatMap(chunk => [...chunk])).toEqual([
      27, 91, 48, 109, 27, 91, 50, 74, 27, 91, 72,
      27, 91, 57, 51, 59, 52, 52, 109, 219, 178, 177, 176,
      27, 91, 51, 52, 59, 52, 52, 109, 219,
      27, 91, 48, 109, 13, 10, 27, 91, 48, 109,
    ])
  })

  it('exports half-block glyphs with endpoint foreground colors and unchanged outside backgrounds', () => {
    const source = new Map([223, 220, 221, 222].map((code, x) => [key(x, 0), { code, fg: 7, bg: 0 }]))
    const cells = rasterizeGradient(gradientRegion(source, { x: 1, y: 0 }), 'linear', { x: 1, y: 0 }, { x: 2, y: 0 }, ink)
    expect([...ansiChunks(cells)].flatMap(chunk => [...chunk])).toEqual([
      27, 91, 48, 109, 27, 91, 50, 74, 27, 91, 72,
      27, 91, 57, 51, 59, 52, 48, 109, 223, 220,
      27, 91, 51, 52, 59, 52, 48, 109, 221, 222,
      27, 91, 48, 109, 13, 10, 27, 91, 48, 109,
    ])
  })
})
