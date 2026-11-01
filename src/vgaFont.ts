import bitmap from './assets/ibm-vga-8x16.json'

export type CanvasFont = 'ibm-vga' | 'consolas'
const atlases = new Map<string, HTMLCanvasElement>()
const MAX_ATLASES = 64

function validateGlyph(code: number, width: number, height: number): void {
  if (!Number.isInteger(code) || code < 32 || code > 255) throw new Error('IBM VGA glyphs require CP437 bytes 32-255.')
  if (!Number.isInteger(width) || width < 1 || width > 32 ||
      !Number.isInteger(height) || height < 1 || height > 64) throw new Error('Invalid IBM VGA glyph size.')
}

export function glyphMask(code: number, width = 8, height = 16, nativeWidth: 8 | 9 = 8): Uint8Array {
  validateGlyph(code, width, height)
  const rows = bitmap.glyphs[code - 32]
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const row = Math.floor((y + 0.5) * 16 / height), column = Math.floor((x + 0.5) * nativeWidth / width)
    mask[y * width + x] = Number(column < 8 ? Boolean(rows[row] & (128 >> column))
      : code >= 192 && code <= 223 && Boolean(rows[row] & 1))
  }
  return mask
}

export function drawVgaGlyph(ctx: CanvasRenderingContext2D, code: number, x: number, y: number, width: number, height: number, nativeWidth: 8 | 9 = 8): void {
  validateGlyph(code, width, height)
  if (code === 32 || code === 255) return
  const color = ctx.fillStyle
  if (typeof color !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) throw new Error('IBM VGA rendering requires a hexadecimal foreground color.')
  const cacheKey = `${color},${width},${height},${nativeWidth}`
  let atlas = atlases.get(cacheKey)
  if (!atlas) {
    atlas = document.createElement('canvas')
    atlas.width = 16 * width; atlas.height = 14 * height
    const atlasContext = atlas.getContext('2d')
    if (!atlasContext) throw new Error('Unable to create the IBM VGA glyph atlas.')
    const image = atlasContext.createImageData(atlas.width, atlas.height)
    const hex = color.length === 4 ? [...color.slice(1)].map(digit => digit + digit).join('') : color.slice(1)
    const rgb = [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16))
    for (let glyph = 0; glyph < 224; glyph++) {
      const mask = glyphMask(glyph + 32, width, height, nativeWidth)
      const left = glyph % 16 * width, top = Math.floor(glyph / 16) * height
      for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
        if (!mask[row * width + column]) continue
        const offset = ((top + row) * atlas.width + left + column) * 4
        image.data[offset] = rgb[0]; image.data[offset + 1] = rgb[1]; image.data[offset + 2] = rgb[2]; image.data[offset + 3] = 255
      }
    }
    atlasContext.putImageData(image, 0, 0)
    if (atlases.size === MAX_ATLASES) atlases.delete(atlases.keys().next().value!)
    atlases.set(cacheKey, atlas)
  }
  const glyph = code - 32
  // Scaling is already baked into integer RGBA pixels, not delegated to the browser.
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(atlas, glyph % 16 * width, Math.floor(glyph / 16) * height, width, height, x, y, width, height)
}
