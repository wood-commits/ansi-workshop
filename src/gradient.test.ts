import { describe, expect, it } from 'vitest'
import { Editor, EMPTY, key, MAX_ROW, pointFromKey, type Cell } from './model'
import { rgbColor } from './colors'
import { gradientRegion, rasterizeGradient } from './gradient'
import { ansiChunks } from './export'

const source = { code: 219, fg: 7, bg: 0 }
const ink = { fg: 14, bg: 1 }
function rectangle(width: number, height: number, row = 0) {
  const cells = new Map<string, Cell>()
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells.set(key(x, row + y), { ...source })
  return cells
}

function outline(row = 0, width = 80) {
  const cells = new Map<string, Cell>()
  for (let x = 1; x <= 7; x++) {
    cells.set(key(x, row), { ...source })
    cells.set(key(x, row + 4), { ...source })
  }
  for (let y = row + 1; y < row + 4; y++) {
    cells.set(key(1, y), { ...source })
    cells.set(key(7, y), { ...source })
  }
  cells.set(key(width - 1, row), { code: 65, fg: 4, bg: 1 })
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
    expect(() => gradientRegion(cells, { x: 79, y: 0 })).toThrow(/not enclosed/)
    expect(cells.size).toBe(8)
  })

  it.each(['linear', 'radial'] as const)('shades an enclosed blank area with a %s gradient without touching barriers', kind => {
    const cells = outline()
    cells.set('4,2', { code: 32, fg: 7, bg: 2 })
    const before = new Map(cells)
    const region = gradientRegion(cells, { x: 2, y: 2 })
    expect(region.size).toBe(14)
    expect([...region.values()]).toEqual(Array.from({ length: 14 }, () => EMPTY))
    const result = rasterizeGradient(region, kind, { x: 2, y: 2 }, { x: 6, y: 2 }, ink, 'ansi', 80, true)
    expect(result.get('2,2')).toEqual({ code: 219, ...ink })
    expect(result.get('6,2')).toEqual({ code: 219, fg: 1, bg: 1 })
    expect(result.has('4,2')).toBe(false)
    expect(result.has('1,2')).toBe(false)
    expect(cells).toEqual(before)
  })

  it('preserves all four half-block outline inks when shading their blank halves', () => {
    const cells = outline()
    cells.set('3,0', { code: 223, fg: 7, bg: 0 })
    cells.set('3,4', { code: 220, fg: 7, bg: 0 })
    cells.set('1,2', { code: 221, fg: 7, bg: 0 })
    cells.set('7,2', { code: 222, fg: 7, bg: 0 })
    const region = gradientRegion(cells, { x: 2, y: 2 })
    const result = rasterizeGradient(region, 'linear', { x: 2, y: 2 }, { x: 6, y: 2 }, ink, 'ansi', 80, true)
    expect(result.size).toBe(19)
    expect(result.get('3,0')).toEqual({ code: 220, fg: 14, bg: 7 })
    expect(result.get('3,4')).toEqual({ code: 223, fg: 14, bg: 7 })
    expect(result.get('1,2')).toEqual({ code: 222, fg: 14, bg: 7 })
    expect(result.get('7,2')).toEqual({ code: 222, fg: 7, bg: 1 })
    cells.set('3,0', { code: 223, fg: 14, bg: 0 })
    const bright = gradientRegion(cells, { x: 2, y: 2 })
    expect(() => rasterizeGradient(bright, 'linear', { x: 2, y: 2 }, { x: 6, y: 2 },
      { fg: 12, bg: 1 }, 'ansi', 80, true)).toThrow(/two bright colors/)
    expect(rasterizeGradient(bright, 'linear', { x: 2, y: 2 }, { x: 6, y: 2 },
      { fg: 12, bg: 1 }, 'ice', 80, true).get('3,0')).toEqual({ code: 223, fg: 14, bg: 12 })
    const rgb = rgbColor('#123456')
    expect(rasterizeGradient(bright, 'linear', { x: 2, y: 2 }, { x: 6, y: 2 },
      { fg: rgb, bg: 1 }, 'tundra', 80, true).get('3,0')).toEqual({ code: 223, fg: 14, bg: rgb })
  })

  it('rejects open blank areas, half-block leaks and distant empty gaps without editing', () => {
    const cells = outline()
    cells.set('4,0', { code: 221, fg: 7, bg: 0 })
    expect(() => gradientRegion(cells, { x: 2, y: 2 })).toThrow(/not enclosed/)
    expect(() => gradientRegion(new Map(), { x: 40, y: 1_000_000_000 })).toThrow(/not enclosed/)
    expect(cells.has('2,2')).toBe(false)
    const gap = new Map([['39,1000000000', source], ['41,1000000000', source], ['40,1000000001', source], ['40,0', source]])
    expect(() => gradientRegion(gap, { x: 40, y: 1_000_000_000 })).toThrow(/not enclosed/)
  })

  it('keeps enclosed gradients sparse at distant safe rows and respects document width', () => {
    for (const row of [1_000_000_000, MAX_ROW - 4]) {
      const editor = new Editor(outline(row, 8), undefined, 'ansi', 8)
      const before = new Map(editor.cells)
      const region = gradientRegion(editor.cells, { x: 2, y: row + 2 }, true, 8)
      expect(region.size).toBe(15)
      const result = rasterizeGradient(region, 'linear', { x: 2, y: row + 2 }, { x: 6, y: row + 2 }, ink, 'ansi', 8, true)
      for (const [id, cell] of result) editor.paint(pointFromKey(id), cell)
      editor.commit()
      editor.undo()
      expect(editor.cells).toEqual(before)
      expect(editor.dirty).toBe(false)
      editor.redo()
      expect(editor.cells.size).toBe(before.size + 15)
      expect(editor.cells.get(key(7, row))).toEqual(before.get(key(7, row)))
    }
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
