import { describe, expect, it, vi } from 'vitest'
import { drawGlyph } from './Canvas'

function pixels(code: number, x: number, y: number, width: number, height: number) {
  const fillRect = vi.fn<CanvasRenderingContext2D['fillRect']>()
  const tiles = new Map<CanvasImageSource, number[][]>()
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const calls: number[][] = []
    tiles.set(this, calls)
    const context: Pick<CanvasRenderingContext2D, 'fillRect'> = { fillRect: (...args) => { calls.push(args) } }
    return context as CanvasRenderingContext2D
  })
  let mask: number[][] | undefined
  const ctx: Pick<CanvasRenderingContext2D, 'fillStyle' | 'createPattern' | 'fillRect'> = {
    fillStyle: '#aaa',
    createPattern: vi.fn((source: CanvasImageSource) => {
      mask = tiles.get(source)
      return { setTransform: vi.fn() }
    }),
    fillRect: (left: number, top: number, w: number, h: number) => {
      if (!mask) { fillRect(left, top, w, h); return }
      for (let py = top; py < top + h; py++) for (let px = left; px < left + w; px++) {
        if (mask.some(([mx, my]) => px % 4 === mx && py % 2 === my)) fillRect(px, py, 1, 1)
      }
    },
  }
  drawGlyph(ctx as CanvasRenderingContext2D, code, x, y, width, height)
  getContext.mockRestore()
  return fillRect.mock.calls
}

describe('shading raster', () => {
  it('fills a shade cell once and reuses its color-specific pattern across sizes and phases', () => {
    const tileFill = vi.fn()
    const tileContext: Partial<CanvasRenderingContext2D> = { fillRect: tileFill }
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(tileContext as CanvasRenderingContext2D)
    const ctx = {
      fillStyle: '#aaa',
      fillRect: vi.fn(),
      createPattern: vi.fn(() => ({ setTransform: vi.fn() })),
    }
    const context: Partial<CanvasRenderingContext2D> = ctx
    for (let row = 0; row < 60; row++) for (let x = 0; x < 80; x++) {
      drawGlyph(context as CanvasRenderingContext2D, 178, x * 10 + 42, row * 20, 10, 20)
    }
    drawGlyph(context as CanvasRenderingContext2D, 178, 3, 1, 8, 16)
    expect(ctx.createPattern).toHaveBeenCalledOnce()
    expect(tileFill).toHaveBeenCalledTimes(6)
    expect(ctx.fillRect).toHaveBeenCalledTimes(4801)
    expect(ctx.fillStyle).toBe('#aaa')
    ctx.fillStyle = '#fff'
    drawGlyph(context as CanvasRenderingContext2D, 178, 0, 0, 8, 16)
    expect(ctx.createPattern).toHaveBeenCalledTimes(2)
    getContext.mockRestore()
  })

  it.each([[176, 0.25], [177, 0.5], [178, 0.75]])(
    'renders CP437 %i at its exact density without fractional pixels',
    (code, density) => {
      for (const [width, height] of [[8, 16], [10, 20], [16, 32], [32, 40]]) {
        const calls = pixels(code, 42, 0, width, height)
        expect(calls).toHaveLength(width * height * density)
        for (const [x, y, w, h] of calls) {
          expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true)
          expect([w, h]).toEqual([1, 1])
          expect(x).toBeGreaterThanOrEqual(42)
          expect(x).toBeLessThan(42 + width)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(y).toBeLessThan(height)
        }
      }
    },
  )

  it.each([176, 177, 178])('tiles CP437 %i continuously across cell boundaries', code => {
    const adjacent = [
      ...pixels(code, 42, 0, 10, 20),
      ...pixels(code, 52, 0, 10, 20),
      ...pixels(code, 42, 20, 10, 20),
      ...pixels(code, 52, 20, 10, 20),
    ]
    const sorted = (calls: number[][]) => calls.map(call => call.join(',')).sort()
    expect(sorted(adjacent)).toEqual(sorted(pixels(code, 42, 0, 20, 40)))
  })

  it('uses complementary light/dark masks and an alternating medium checkerboard', () => {
    const light = new Set(pixels(176, 0, 0, 8, 16).map(([x, y]) => `${x},${y}`))
    const dark = new Set(pixels(178, 0, 0, 8, 16).map(([x, y]) => `${x},${y}`))
    expect([...light].filter(point => dark.has(point))).toEqual([])
    expect(new Set([...light, ...dark]).size).toBe(128)
    expect(pixels(176, 0, 0, 4, 2)).toEqual([[0, 0, 1, 1], [2, 1, 1, 1]])
    expect(pixels(177, 0, 0, 2, 2)).toEqual([[0, 0, 1, 1], [1, 1, 1, 1]])
  })
})
