import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { CP437 } from '../src/ansi.ts'

export const FONT_SHA256 = '0f09694548cd0190408ffd60d64f105f6784025980c20bca796efbf16632c5a3'
const source = new URL('../public/fonts/Web437_IBM_VGA_8x16.woff', import.meta.url)
const destination = new URL('../src/assets/ibm-vga-8x16.json', import.meta.url)

export function generateBitmap(font: Buffer): number[][] {
  if (createHash('sha256').update(font).digest('hex') !== FONT_SHA256) throw new Error('The bundled font checksum does not match the official Web437 IBM VGA 8x16 source.')
  const tables = new Map<string, Buffer>()
  for (let i = 0; i < font.readUInt16BE(12); i++) {
    const record = 44 + i * 20
    const offset = font.readUInt32BE(record + 4)
    const compressedLength = font.readUInt32BE(record + 8), length = font.readUInt32BE(record + 12)
    const bytes = font.subarray(offset, offset + compressedLength)
    tables.set(font.toString('ascii', record, record + 4), compressedLength < length ? inflateSync(bytes) : bytes)
  }
  const table = (name: string) => {
    const bytes = tables.get(name)
    if (!bytes) throw new Error(`Font is missing its ${name} table.`)
    return bytes
  }
  const head = table('head'), hhea = table('hhea')
  if (head.readUInt16BE(18) !== 1600 || head.readInt16BE(50) !== 0 ||
      hhea.readInt16BE(4) !== 1200 || hhea.readInt16BE(6) !== -400) throw new Error('Unexpected native font metrics.')
  const cmap = table('cmap'), loca = table('loca'), glyf = table('glyf')
  let mapping: Buffer | undefined
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const record = 4 + i * 8
    if (cmap.readUInt16BE(record) === 3 && cmap.readUInt16BE(record + 2) === 1) {
      mapping = cmap.subarray(cmap.readUInt32BE(record + 4))
      break
    }
  }
  if (!mapping || mapping.readUInt16BE(0) !== 4) throw new Error('Font is missing its Unicode BMP mapping.')
  const map = mapping, segments = map.readUInt16BE(6) / 2
  const ends = 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, ranges = deltas + segments * 2
  const glyphIndex = (unicode: number) => {
    for (let i = 0; i < segments; i++) {
      const start = map.readUInt16BE(starts + i * 2)
      if (unicode < start || unicode > map.readUInt16BE(ends + i * 2)) continue
      const range = map.readUInt16BE(ranges + i * 2), delta = map.readUInt16BE(deltas + i * 2)
      const glyph = range ? map.readUInt16BE(ranges + i * 2 + range + (unicode - start) * 2) : unicode
      return glyph || !range ? (glyph + delta) & 0xffff : 0
    }
    return 0
  }
  return CP437.slice(32).map((character, index) => {
    const glyph = glyphIndex(character.codePointAt(0)!)
    if (!glyph) throw new Error(`Missing CP437 byte ${index + 32}.`)
    const start = loca.readUInt16BE(glyph * 2) * 2, end = loca.readUInt16BE((glyph + 1) * 2) * 2
    if (start === end) return Array<number>(16).fill(0)
    const outline = glyf.subarray(start, end), count = outline.readInt16BE(0)
    if (count < 0) throw new Error('Composite glyphs are not part of the native bitmap source.')
    const endpoints = Array.from({ length: count }, (_, i) => outline.readUInt16BE(10 + i * 2))
    const pointCount = (endpoints.at(-1) ?? -1) + 1
    let position = 12 + count * 2 + outline.readUInt16BE(10 + count * 2)
    const flags: number[] = []
    while (flags.length < pointCount) {
      const flag = outline[position++]
      const copies = flag & 8 ? outline[position++] + 1 : 1
      for (let i = 0; i < copies; i++) flags.push(flag)
    }
    const coordinates = (short: number, same: number) => {
      let value = 0
      return flags.map(flag => {
        if (flag & short) value += outline[position++] * (flag & same ? 1 : -1)
        else if (!(flag & same)) { value += outline.readInt16BE(position); position += 2 }
        return value
      })
    }
    const xs = coordinates(2, 16), ys = coordinates(4, 32)
    const contours: Array<Array<{ x: number; y: number }>> = []
    let first = 0
    for (const last of endpoints) {
      const points = xs.slice(first, last + 1).map((x, i) => ({ x, y: ys[first + i] }))
      if (points.some((point, i) => !(flags[first + i] & 1) || point.x % 100 || point.y % 100 ||
          (point.x !== points[(i + 1) % points.length].x && point.y !== points[(i + 1) % points.length].y))) {
        throw new Error(`CP437 byte ${index + 32} does not have a whole-pixel rectangular outline.`)
      }
      contours.push(points)
      first = last + 1
    }
    return Array.from({ length: 16 }, (_, row) => {
      let mask = 0
      const y = 1200 - (row + 0.5) * 100
      for (let column = 0; column < 8; column++) {
        const x = (column + 0.5) * 100
        let winding = 0
        for (const points of contours) for (let i = 0; i < points.length; i++) {
          const a = points[i], b = points[(i + 1) % points.length]
          if (a.x > x && a.x === b.x) {
            if (a.y <= y && b.y > y) winding++
            if (b.y <= y && a.y > y) winding--
          }
        }
        if (winding) mask |= 128 >> column
      }
      return mask
    })
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed package-relative font URL, never user input.
  const font = readFileSync(source)
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed package-relative bitmap URL, never user input.
  writeFileSync(destination, JSON.stringify({
    font: 'Web437 IBM VGA 8x16',
    author: 'VileR',
    source: 'https://int10h.org/oldschool-pc-fonts/',
    license: 'https://creativecommons.org/licenses/by-sa/4.0/',
    modifications: 'Converted unchanged glyph outlines to 8x16 row masks indexed by CP437 bytes 32-255.',
    sourceSHA256: FONT_SHA256,
    glyphs: generateBitmap(font),
  }) + '\n')
  console.log('Generated the CC BY-SA 4.0 CP437 bitmap from the verified Web437 source.')
}
