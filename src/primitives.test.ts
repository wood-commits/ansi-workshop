import { describe, expect, it } from 'vitest'
import { Editor, EMPTY, MAX_ROW, pointFromKey, validPoint, type Cell } from './model'
import { ansiChunks } from './export'
import { rasterizePrimitive, subtractPrimitive, type PrimitiveKind } from './primitives'
import { BLOCK_GLYPHS } from './ansi'

const ink = { fg: 14, bg: 1 }
describe('primitive rasterization', () => {
  it('fills a rectangle exactly and leaves outline interiors untouched', () => {
    const start = { x: 10, y: 10 }, end = { x: 20, y: 20 }
    const filled = rasterizePrimitive('rectangle', true, start, end, 0, ink)
    expect(filled.size).toBe(121)
    expect([...filled.values()]).toEqual(Array.from({ length: 121 }, () => ({ code: 219, ...ink })))
    const outline = rasterizePrimitive('rectangle', false, start, end, 0, ink)
    expect(outline.has('15,15')).toBe(false)
    expect(outline.get('15,10')).toEqual({ code: 223, ...ink })
    expect(outline.get('15,20')).toEqual({ code: 220, ...ink })
    expect(outline.get('10,15')).toEqual({ code: 219, ...ink })
    expect(rasterizePrimitive('rectangle', true, end, start, 0, ink)).toEqual(filled)
  })

  describe('primitive subtraction', () => {
    const halves = [[223, 220], [220, 223], [221, 222], [222, 221]]
    const cut = (cell: Cell, code: number) => subtractPrimitive(
      new Map([['0,0', cell]]), new Map([['0,0', { code, fg: 5, bg: 6 }]]),
    ).get('0,0')

    it.each(halves)('subtracts %i from a full block as opposite half %i in the original foreground', (code, opposite) => {
      expect(cut({ code: 219, fg: 14, bg: 1 }, code)).toEqual({ code: opposite, fg: 14, bg: 0 })
      expect(cut({ code: 219, fg: 2, bg: 7 }, code)).toEqual({ code: opposite, fg: 2, bg: 0 })
    })

    it.each(halves)('preserves the correct foreground or background when subtracting half %i', (code, opposite) => {
      expect(cut({ code, fg: 14, bg: 3 }, code)).toEqual({ code: opposite, fg: 3, bg: 0 })
      expect(cut({ code: opposite, fg: 14, bg: 3 }, code)).toEqual({ code: opposite, fg: 14, bg: 0 })
      expect(cut({ code, fg: 14, bg: 0 }, code)).toEqual(EMPTY)
      for (const blank of [32, 255]) expect(cut({ code: blank, fg: 14, bg: 3 }, code)).toEqual({ code: opposite, fg: 3, bg: 0 })
    })

    it('clears unrepresentable quarter blocks, text and shading instead of adding or recoloring remaining pixels', () => {
      for (const code of [221, 222]) for (const mask of [223, 220]) {
        expect(cut({ code, fg: 14, bg: 3 }, mask)).toEqual(EMPTY)
        expect(cut({ code, fg: 14, bg: 0 }, mask)).toEqual(EMPTY)
      }
      for (const code of [65, 176, 177, 178, 254]) {
        expect(cut({ code, fg: 14, bg: 1 }, 223)).toEqual(EMPTY)
        expect(cut({ code, fg: 3, bg: 3 }, 223)).toEqual({ code: 220, fg: 3, bg: 0 })
      }
    })

    it('erases full mask cells and skips unstored blanks without painting preview colors', () => {
      for (const code of [32, 65, 176, 219, 220, 221, 222, 223, 255]) {
        expect(cut({ code, fg: 14, bg: 3 }, 219)).toEqual(EMPTY)
      }
      const mask = rasterizePrimitive('ellipse', true, { x: 10, y: 10 }, { x: 30, y: 20 }, 0, ink)
      expect(subtractPrimitive(new Map(), mask).size).toBe(0)
    })

    it('never leaves ink inside a cut and retains exact quadrant colors whenever representable', () => {
      const colors = (cell: Cell) => {
        const [left, top, width, height] = BLOCK_GLYPHS.get(cell.code) ?? [0, 0, 0, 0]
        return [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].map(([x, y]) =>
          x >= left && x < left + width && y >= top && y < top + height ? cell.fg : cell.bg)
      }
      for (const original of [219, 223, 220, 221, 222]) for (const mask of [219, 223, 220, 221, 222]) {
        for (const fg of [0, 2, 14, 15]) for (const bg of [0, 1, 3, 7]) {
          const source = { code: original, fg, bg }, before = colors(source)
          const removed = colors({ code: mask, fg: 1, bg: 0 })
          const expected = before.map((color, i) => removed[i] ? 0 : color)
          const remaining = expected.filter((_, i) => !removed[i])
          const representable = !remaining.length || remaining.every(color => color === remaining[0])
          const result = colors(cut(source, mask)!)
          expect(result).toEqual(representable ? expected : [0, 0, 0, 0])
        }
      }
    })

    it.each<PrimitiveKind>(['rectangle', 'ellipse', 'rounded-rectangle', 'star'])('subtracts rotated filled/outline %s sparsely with one undo step', kind => {
      for (const filled of [true, false]) {
        const before = rasterizePrimitive('rectangle', true, { x: 0, y: 1_000_000_000 }, { x: 79, y: 1_000_000_030 }, 0, { fg: 14, bg: 1 })
        const editor = new Editor(before)
        const mask = rasterizePrimitive(kind, filled, { x: 20, y: 1_000_000_005 }, { x: 55, y: 1_000_000_020 }, Math.PI / 6, { fg: 4, bg: 2 })
        const result = subtractPrimitive(editor.cells, mask)
        expect(result.size).toBeGreaterThan(0)
        expect(result.size).toBeLessThanOrEqual(mask.size)
        for (const [id, cell] of result) editor.paint(pointFromKey(id), cell)
        editor.commit()
        const after = new Map(editor.cells)
        expect(after.get('0,1000000000')).toEqual({ code: 219, fg: 14, bg: 1 })
        editor.undo()
        expect(editor.cells).toEqual(before)
        expect(editor.dirty).toBe(false)
        editor.redo()
        expect(editor.cells).toEqual(after)
      }
    })

    it('rejects invalid subtraction geometry before returning edits', () => {
      const source = new Map([['0,0', { code: 219, ...ink }]])
      expect(() => subtractPrimitive(source, new Map([['0,0', { code: 65, ...ink }]]))).toThrow(/block/)
      expect(() => subtractPrimitive(source, new Map([[`0,${MAX_ROW + 1}`, { code: 219, ...ink }]]))).toThrow(/coordinates/)
      expect(source.get('0,0')).toEqual({ code: 219, ...ink })
    })

    it('exports surviving half blocks with original bright foregrounds and promoted background colors as CP437 bytes', () => {
      const editor = new Editor(new Map([
        ['0,0', { code: 219, fg: 14, bg: 1 }],
        ['1,0', { code: 223, fg: 14, bg: 3 }],
        ['2,0', { code: 219, fg: 4, bg: 1 }],
      ]))
      const mask = new Map([['0,0', { code: 223, ...ink }], ['1,0', { code: 223, ...ink }], ['2,0', { code: 219, ...ink }]])
      for (const [id, cell] of subtractPrimitive(editor.cells, mask)) editor.paint(pointFromKey(id), cell)
      editor.commit()
      expect([...ansiChunks(editor.cells)].flatMap(chunk => [...chunk])).toEqual([
        27, 91, 48, 109, 27, 91, 50, 74, 27, 91, 72,
        27, 91, 57, 51, 59, 52, 48, 109, 220,
        27, 91, 51, 54, 59, 52, 48, 109, 220,
        27, 91, 48, 109, 13, 10, 27, 91, 48, 109,
      ])
    })
  })

  it.each<PrimitiveKind>(['rectangle', 'ellipse', 'rounded-rectangle', 'star'])(
    'rasterizes %s with legal blocks, colors, rotation, and sparse distant coordinates',
    kind => {
      for (const filled of [true, false]) {
        const cells = rasterizePrimitive(kind, filled, { x: 20, y: 1_000_000_000 }, { x: 40, y: 1_000_000_010 }, Math.PI / 5, ink)
        expect(cells.size).toBeGreaterThan(0)
        expect(cells.size).toBeLessThan(800)
        for (const [id, cell] of cells) {
          expect(validPoint(pointFromKey(id))).toBe(true)
          expect([219, 220, 221, 222, 223]).toContain(cell.code)
          expect(cell).toMatchObject(ink)
        }
        const editor = new Editor()
        for (const [id, cell] of cells) editor.paint(pointFromKey(id), cell)
        editor.commit()
        editor.undo()
        expect(editor.cells.size).toBe(0)
        editor.redo()
        expect(editor.cells).toEqual(cells)
      }
    },
  )

  it('uses all four half-block orientations on curved edges', () => {
    const cells = rasterizePrimitive('ellipse', true, { x: 10, y: 10 }, { x: 40, y: 25 }, 0, ink)
    const codes = new Set([...cells.values()].map(cell => cell.code))
    for (const code of [219, 220, 221, 222, 223]) expect(codes.has(code)).toBe(true)
  })

  it.each([
    ...Array.from({ length: 79 }, (_, index) => [index + 2, 13]),
    ...[4, 9, 17, 31, 58, 80].flatMap(width => Array.from({ length: 24 }, (_, index) => [width, index + 2]).filter(([, height]) => height !== 13)),
  ])('keeps filled ellipse edges monotone and symmetric at %i columns by %i rows', (width, height) => {
    const cells = rasterizePrimitive('ellipse', true, { x: 0, y: 0 }, { x: width - 1, y: height - 1 }, 0, ink)
    const spans = new Map<number, { left: number; right: number }>()
    for (const [id, cell] of cells) {
      const { x, y } = pointFromKey(id)
      const [left, top, w, h] = BLOCK_GLYPHS.get(cell.code)!
      for (let sy = top * 2; sy < (top + h) * 2; sy++) {
        const row = y * 2 + sy
        const span = { left: x * 2 + left * 2, right: x * 2 + (left + w) * 2 - 1 }
        const previous = spans.get(row)
        spans.set(row, previous ? { left: Math.min(previous.left, span.left), right: Math.max(previous.right, span.right) } : span)
      }
    }
    let previous = { left: Infinity, right: -Infinity }
    for (let row = 0; row < height; row++) {
      const span = spans.get(row)
      if (!span) continue
      expect(span.left, `Left edge turns inward at half-row ${row}`).toBeLessThanOrEqual(previous.left)
      expect(span.right, `Right edge turns inward at half-row ${row}`).toBeGreaterThanOrEqual(previous.right)
      previous = span
    }
    for (const [row, span] of spans) {
      expect(span.left + span.right, `Horizontal symmetry at half-row ${row}`).toBe(width * 2 - 1)
      expect(span, `Vertical symmetry at half-row ${row}`).toEqual(spans.get(height * 2 - row - 1))
    }
  })

  it.each<PrimitiveKind>(['rectangle', 'ellipse', 'rounded-rectangle', 'star'])('keeps rotated %s shapes connected', kind => {
    for (const [filled, degrees] of [true, false].flatMap(filled => [0, 15, 25, 45, 70, 90, 135].map(degrees => [filled, degrees] as const))) {
      const cells = rasterizePrimitive(kind, filled, { x: 20, y: 20 }, { x: 60, y: 37 }, degrees * Math.PI / 180, ink)
      const pixels = new Set<string>()
      for (const [id, cell] of cells) {
        const { x, y } = pointFromKey(id)
        for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
          if (cell.code === 219 || (cell.code === 223 && sy === 0) || (cell.code === 220 && sy === 1)
              || (cell.code === 221 && sx === 0) || (cell.code === 222 && sx === 1)) pixels.add(`${x * 2 + sx},${y * 2 + sy}`)
        }
      }
      const queue = [pointFromKey(pixels.values().next().value!)]
      pixels.delete(`${queue[0].x},${queue[0].y}`)
      for (let i = 0; i < queue.length; i++) {
        const { x, y } = queue[i]
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (pixels.delete(`${x + dx},${y + dy}`)) queue.push({ x: x + dx, y: y + dy })
        }
      }
      expect(pixels.size, `${filled ? 'Filled' : 'Outlined'} ${kind} at ${degrees} degrees has disconnected pixels`).toBe(0)
    }
  })

  it('exports primitive edges as exact binary CP437 bytes with per-row resets', () => {
    const cells = rasterizePrimitive('rectangle', false, { x: 0, y: 0 }, { x: 4, y: 2 }, 0, { fg: 7, bg: 0 })
    const reset = [27, 91, 48, 109]
    expect([...ansiChunks(cells)].flatMap(chunk => [...chunk])).toEqual([
      ...reset, 27, 91, 50, 74, 27, 91, 72,
      219, 223, 223, 223, 219, ...reset, 13, 10,
      219, 32, 32, 32, 219, ...reset, 13, 10,
      219, 220, 220, 220, 219, ...reset, 13, 10,
      ...reset,
    ])
  })

  it('rotates in physical 1:2 cell proportions and clips columns without erasing outside cells', () => {
    const start = { x: 30, y: 20 }, end = { x: 49, y: 23 }
    const cells = rasterizePrimitive('rectangle', true, start, end, Math.PI / 2, ink)
    const points = [...cells.keys()].map(pointFromKey)
    expect(Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)) + 1).toBe(8)
    expect(Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) + 1).toBe(10)
    const clipped = rasterizePrimitive('star', true, { x: 0, y: 0 }, { x: 30, y: 15 }, Math.PI / 3, ink)
    expect([...clipped.keys()].every(id => validPoint(pointFromKey(id)))).toBe(true)
    expect(() => rasterizePrimitive('rectangle', true, { x: 10, y: MAX_ROW }, { x: 70, y: MAX_ROW }, Math.PI / 2, ink)).toThrow(/coordinate/i)
  })

  it.each<PrimitiveKind>(['rectangle', 'ellipse', 'rounded-rectangle', 'star'])('supports a one-cell %s', kind => {
    expect(rasterizePrimitive(kind, true, { x: 0, y: 0 }, { x: 0, y: 0 }, 0, ink).size).toBe(1)
  })
})
