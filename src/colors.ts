import { ANSI_COLORS, COLOR_NAMES } from './ansi'

export type DocumentFormat = 'ansi' | 'ice' | 'tundra'
// Tagged RGB values cannot be mistaken for classic palette indexes.
const RGB_TAG = 0x1000000

export function validColor(value: number, background = false, format: DocumentFormat = 'ansi'): boolean {
  return Number.isInteger(value) && (value >= 0 && value < (background && format === 'ansi' ? 8 : 16) ||
    format === 'tundra' && value >= RGB_TAG && value < RGB_TAG * 2)
}

export function colorCss(value: number): string {
  if (!validColor(value, false, 'tundra')) throw new Error('Invalid color value.')
  return value < 16 ? ANSI_COLORS[value] : `#${(value - RGB_TAG).toString(16).padStart(6, '0')}`
}

export function colorName(value: number): string {
  if (!validColor(value, false, 'tundra')) throw new Error('Invalid color value.')
  return value < 16 ? COLOR_NAMES[value] : colorCss(value)
}

export function rgbColor(hex: string): number {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error('RGB colors require six hexadecimal digits.')
  const normalized = hex.toLowerCase()
  const index = ANSI_COLORS.findIndex(color => color === normalized)
  return index < 0 ? RGB_TAG + Number.parseInt(normalized.slice(1), 16) : index
}
