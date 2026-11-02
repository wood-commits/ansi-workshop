import { MAX_COLUMNS, WIDTH } from './model'
import type { CanvasFont } from './vgaFont'

export const SETTINGS_KEY = 'ansi-workshop.settings'
export const APP_THEMES = [
  { id: 'default', label: 'Original (default)' },
  { id: 'light', label: 'Light' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'forest', label: 'Forest' },
  { id: 'amber', label: 'Amber' },
] as const
export type AppTheme = typeof APP_THEMES[number]['id']
export function isAppTheme(value: unknown): value is AppTheme {
  return APP_THEMES.some(theme => theme.id === value)
}

export interface Settings {
  theme: AppTheme
  font: CanvasFont
  cellSize: 'native' | 'classic' | 'double'
  nativeWidth: 8 | 9
  columns: number
  ansiMode: 'ansi' | 'ice'
  collapseHeader: boolean
  iconOnlyToolbar: boolean
}
export const DEFAULT_SETTINGS: Readonly<Settings> = {
  theme: 'default',
  font: 'ibm-vga', cellSize: 'native', nativeWidth: 8, columns: WIDTH, ansiMode: 'ansi',
  collapseHeader: false, iconOnlyToolbar: false,
}

function parseSettings(text: string): Settings {
  if (text.length > 1024) throw new Error('Stored settings are too large.')
  const value: unknown = JSON.parse(text)
  const invalid = () => new Error('Stored settings are invalid or use an unsupported version.')
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('version' in value)) throw invalid()
  // Older records keep the original theme; version 1 also predates layout options.
  const layout = value.version === 1 && Object.keys(value).length === 6
    ? { collapseHeader: false, iconOnlyToolbar: false }
    : ((value.version === 2 && Object.keys(value).length === 8) ||
        (value.version === 3 && Object.keys(value).length === 9)) &&
        'collapseHeader' in value && typeof value.collapseHeader === 'boolean' &&
        'iconOnlyToolbar' in value && typeof value.iconOnlyToolbar === 'boolean'
      ? { collapseHeader: value.collapseHeader, iconOnlyToolbar: value.iconOnlyToolbar }
      : undefined
  const theme = value.version === 3 ? ('theme' in value ? value.theme : undefined) : 'default'
  if (!layout || !isAppTheme(theme) ||
      !('font' in value) || (value.font !== 'ibm-vga' && value.font !== 'consolas') ||
      !('cellSize' in value) || (value.cellSize !== 'native' && value.cellSize !== 'classic' && value.cellSize !== 'double') ||
      !('nativeWidth' in value) || (value.nativeWidth !== 8 && value.nativeWidth !== 9) ||
      !('columns' in value) || typeof value.columns !== 'number' ||
      !Number.isInteger(value.columns) || value.columns < 1 || value.columns > MAX_COLUMNS ||
      !('ansiMode' in value) || (value.ansiMode !== 'ansi' && value.ansiMode !== 'ice')) {
    throw invalid()
  }
  return { theme, font: value.font, cellSize: value.cellSize, nativeWidth: value.nativeWidth, columns: value.columns, ansiMode: value.ansiMode, ...layout }
}

export function loadSettings(): { settings: Readonly<Settings>; error?: Error } {
  try {
    const text = window.localStorage.getItem(SETTINGS_KEY)
    return { settings: text === null ? DEFAULT_SETTINGS : parseSettings(text) }
  } catch {
    return { settings: DEFAULT_SETTINGS, error: new Error('Settings could not be loaded from local storage. Defaults are in use; artwork is not stored.') }
  }
}

export function saveSettings({ theme, font, cellSize, nativeWidth, columns, ansiMode, collapseHeader, iconOnlyToolbar }: Settings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 3, theme, font, cellSize, nativeWidth, columns, ansiMode, collapseHeader, iconOnlyToolbar }))
  } catch {
    throw new Error('Settings could not be saved to local storage. Changes apply only to this session; artwork is not stored.')
  }
}
