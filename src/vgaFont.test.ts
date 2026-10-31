import { describe, expect, it, vi } from 'vitest'
import { generateBitmap, FONT_SHA256 } from '../scripts/generate-font'
import bitmap from './assets/ibm-vga-8x16.json'
import { drawVgaGlyph, glyphMask } from './vgaFont'
import { BLOCK_GLYPHS } from './ansi'

describe('licensed IBM VGA bitmap', () => {
  it('reproduces the bundled bitmap from the verified web font without a browser font engine', () => {
    expect(bitmap.sourceSHA256).toBe(FONT_SHA256)
    expect(bitmap.license).toBe('https://creativecommons.org/licenses/by-sa/4.0/')
    expect(generateBitmap(readFileSync(resolve('public', 'fonts', 'Web437_IBM_VGA_8x16.woff')))).toEqual(bitmap.glyphs)
    expect(bitmap.glyphs).toHaveLength(224)
    for (const rows of bitmap.glyphs) {
      expect(rows).toHaveLength(16)
      expect(rows.every(value => Number.isInteger(value) && value >= 0 && value <= 255)).toBe(true)
    }
    expect(() => generateBitmap(Buffer.from('not the pinned font'))).toThrow('checksum')
  })

  it('keeps spaces blank, the CP437 house visible, and the original IBM 7/9 upper/lower block split', () => {
    expect(glyphMask(32).some(Boolean)).toBe(false)
    expect(glyphMask(255).some(Boolean)).toBe(false)
    expect(glyphMask(127).some(Boolean)).toBe(true)
    for (const [code, [left, top, width, height]] of BLOCK_GLYPHS) {
      const mask = glyphMask(code)
      for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) {
        const inside = code === 223 ? y < 7 : code === 220 ? y >= 7
          : x >= left * 8 && x < (left + width) * 8 && y >= top * 16 && y < (top + height) * 16
        expect(mask[y * 8 + x]).toBe(Number(inside))
      }
    }
    expect(bitmap.glyphs[65 - 32]).toEqual([0, 0, 16, 56, 108, 198, 198, 254, 198, 198, 198, 198, 0, 0, 0, 0])
  })

  it.each([[176, 0.25], [177, 0.5], [178, 0.75]])('keeps native CP437 %i shading density', (code, density) => {
    expect(glyphMask(code).reduce((sum, pixel) => sum + pixel, 0)).toBe(128 * density)
    expect(glyphMask(code, 16, 32).reduce((sum, pixel) => sum + pixel, 0)).toBe(512 * density)
  })

  it('uses exact 2x pixels and deterministic nearest-neighbor pixels at 10x20 for every printable byte', () => {
    for (let code = 32; code <= 255; code++) {
      const native = glyphMask(code)
      for (const [width, height] of [[10, 20], [16, 32]]) {
        const scaled = glyphMask(code, width, height)
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          expect(scaled[y * width + x]).toBe(native[Math.floor((y + 0.5) * 16 / height) * 8 + Math.floor((x + 0.5) * 8 / width)])
        }
      }
    }
  })

  it('creates a reusable color/size atlas and only draws unscaled images with smoothing disabled', () => {
    const createImageData = vi.fn<(width: number | ImageData, height?: number) => ImageData>().mockImplementation((width, height) => {
      const w = typeof width === 'number' ? width : width.width
      const h = typeof width === 'number' ? height! : width.height
      return { width: w, height: h, colorSpace: 'srgb', data: new Uint8ClampedArray(w * h * 4) }
    })
    const putImageData = vi.fn()
    const atlasContext: Partial<CanvasRenderingContext2D> = { createImageData, putImageData }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(atlasContext as CanvasRenderingContext2D)
    const ctx = { fillStyle: '#abcdef', drawImage: vi.fn(), imageSmoothingEnabled: true }
    const context: Partial<CanvasRenderingContext2D> = ctx
    drawVgaGlyph(context as CanvasRenderingContext2D, 65, 42, 0, 16, 32)
    drawVgaGlyph(context as CanvasRenderingContext2D, 66, 58, 32, 16, 32)
    expect(createImageData).toHaveBeenCalledOnce()
    expect(putImageData).toHaveBeenCalledOnce()
    expect(ctx.imageSmoothingEnabled).toBe(false)
    expect(ctx.drawImage.mock.calls[0].slice(2)).toEqual([64, 16, 32, 42, 0, 16, 32])
    const data = createImageData.mock.results[0].value.data
    const colors = new Set<string>()
    for (let i = 0; i < data.length; i += 4) colors.add([...data.slice(i, i + 4)].join(','))
    expect(colors).toEqual(new Set(['0,0,0,0', '171,205,239,255']))
  })

  it('rejects invalid byte and size inputs rather than rendering an unrelated glyph', () => {
    for (const code of [0, 31, 256, NaN, 65.5]) expect(() => glyphMask(code)).toThrow('CP437')
    for (const width of [0, NaN, 1.5, 33]) expect(() => glyphMask(65, width, 16)).toThrow('size')
  })
})
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
