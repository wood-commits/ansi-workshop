export const ANSI_COLORS = [
  '#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
  '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff',
] as const

export const BACKGROUND_COLORS = ANSI_COLORS.slice(0, 8)

export const BLOCK_GLYPHS: ReadonlyMap<number, readonly [number, number, number, number]> = new Map([
  [219, [0, 0, 1, 1]], [223, [0, 0, 1, 0.5]], [220, [0, 0.5, 1, 0.5]],
  [221, [0, 0, 0.5, 1]], [222, [0.5, 0, 0.5, 1]],
])

export const COLOR_NAMES = [
  'Black', 'Blue', 'Green', 'Cyan', 'Red', 'Magenta', 'Brown', 'Light gray',
  'Dark gray', 'Light blue', 'Light green', 'Light cyan', 'Light red', 'Light magenta', 'Yellow', 'White',
] as const

const highAscii = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '
export const CP437 = [...Array.from({ length: 128 }, (_, code) => code === 127 ? '⌂' : String.fromCharCode(code)), ...highAscii]

export const PALETTES: ReadonlyArray<{ name: string; codes: readonly number[] }> = [
  { name: 'Blocks & shading', codes: [176, 177, 178, 219, 223, 220, 221, 222, 254, 250] },
  { name: 'Single lines', codes: [218, 191, 192, 217, 196, 179, 195, 180, 194, 193, 197, 32] },
  { name: 'Double lines', codes: [201, 187, 200, 188, 205, 186, 204, 185, 203, 202, 206, 32] },
  { name: 'Mixed lines', codes: [213, 184, 212, 190, 214, 183, 211, 189, 198, 181, 199, 182] },
  ...Array.from({ length: 19 }, (_, group) => ({
    name: `CP437 ${32 + group * 12}-${Math.min(255, 43 + group * 12)}`,
    codes: Array.from({ length: Math.min(12, 256 - (32 + group * 12)) }, (_, i) => 32 + group * 12 + i),
  })),
]

export function characterCode(character: string): number | undefined {
  const code = CP437.indexOf(character, 32)
  return code < 32 ? undefined : code
}

const horizontalPairs = [
  [218, 191], [192, 217], [195, 180], [201, 187], [200, 188], [204, 185],
  [221, 222], [40, 41], [47, 92], [60, 62], [91, 93], [123, 125],
  [213, 184], [212, 190], [214, 183], [211, 189], [198, 181], [199, 182],
]
const verticalPairs = [
  [218, 192], [191, 217], [194, 193], [201, 200], [187, 188], [203, 202],
  [220, 223], [47, 92], [213, 212], [184, 190], [214, 211], [183, 189],
  [209, 207], [210, 208],
]

export function flipCharacter(code: number, axis: 'x' | 'y'): number {
  for (const [a, b] of axis === 'x' ? horizontalPairs : verticalPairs) {
    if (code === a) return b
    if (code === b) return a
  }
  return code
}
