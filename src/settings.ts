import { MAX_COLUMNS, WIDTH } from './model'
import type { CanvasFont } from './vgaFont'

export const SETTINGS_KEY = 'ansi-workshop.settings'
export interface Settings {
  font: CanvasFont
  cellSize: 'native' | 'classic' | 'double'
  nativeWidth: 8 | 9
  columns: number
  ansiMode: 'ansi' | 'ice'
}
export const DEFAULT_SETTINGS: Readonly<Settings> = {
  font: 'ibm-vga', cellSize: 'native', nativeWidth: 8, columns: WIDTH, ansiMode: 'ansi',
}

function parseSettings(text: string): Settings {
  if (text.length > 1024) throw new Error('Stored settings are too large.')
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
      Object.keys(value).length !== 6 || !('version' in value) || value.version !== 1 ||
      !('font' in value) || (value.font !== 'ibm-vga' && value.font !== 'consolas') ||
      !('cellSize' in value) || (value.cellSize !== 'native' && value.cellSize !== 'classic' && value.cellSize !== 'double') ||
      !('nativeWidth' in value) || (value.nativeWidth !== 8 && value.nativeWidth !== 9) ||
      !('columns' in value) || typeof value.columns !== 'number' ||
      !Number.isInteger(value.columns) || value.columns < 1 || value.columns > MAX_COLUMNS ||
      !('ansiMode' in value) || (value.ansiMode !== 'ansi' && value.ansiMode !== 'ice')) {
    throw new Error('Stored settings are invalid or use an unsupported version.')
  }
  return { font: value.font, cellSize: value.cellSize, nativeWidth: value.nativeWidth, columns: value.columns, ansiMode: value.ansiMode }
}

export function loadSettings(): { settings: Readonly<Settings>; error?: Error } {
  try {
    const text = window.localStorage.getItem(SETTINGS_KEY)
    return { settings: text === null ? DEFAULT_SETTINGS : parseSettings(text) }
  } catch {
    return { settings: DEFAULT_SETTINGS, error: new Error('Settings could not be loaded from local storage. Defaults are in use; artwork is not stored.') }
  }
}

export function saveSettings({ font, cellSize, nativeWidth, columns, ansiMode }: Settings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 1, font, cellSize, nativeWidth, columns, ansiMode }))
  } catch {
    throw new Error('Settings could not be saved to local storage. Changes apply only to this session; artwork is not stored.')
  }
}
