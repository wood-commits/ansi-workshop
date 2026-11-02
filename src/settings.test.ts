import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, SETTINGS_KEY } from './settings'

describe('local Settings storage', () => {
  it('uses defaults when absent and writes only the versioned preference whitelist', () => {
    window.localStorage.clear()
    expect(loadSettings()).toEqual({ settings: DEFAULT_SETTINGS })
    const settings = { ...DEFAULT_SETTINGS, columns: 512, art: 'not stored', token: 'not stored' }
    saveSettings(settings)
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!)).toEqual({ version: 3, ...DEFAULT_SETTINGS, columns: 512 })
    expect(loadSettings()).toEqual({ settings: { ...DEFAULT_SETTINGS, columns: 512 } })
    saveSettings({ ...DEFAULT_SETTINGS, collapseHeader: true, iconOnlyToolbar: true })
    expect(loadSettings()).toEqual({ settings: { ...DEFAULT_SETTINGS, collapseHeader: true, iconOnlyToolbar: true } })
  })

  it('migrates version 1 records with layout preferences off, without rewriting storage', () => {
    const stored = JSON.stringify({ version: 1, font: 'consolas', cellSize: 'native', nativeWidth: 8, columns: 132, ansiMode: 'ansi' })
    window.localStorage.setItem(SETTINGS_KEY, stored)
    expect(loadSettings()).toEqual({ settings: { ...DEFAULT_SETTINGS, font: 'consolas', columns: 132 } })
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBe(stored)
  })

  it('migrates version 2 records with the original theme, without rewriting storage', () => {
    const stored = JSON.stringify({ version: 2, font: 'ibm-vga', cellSize: 'double', nativeWidth: 9, columns: 132, ansiMode: 'ice', collapseHeader: true, iconOnlyToolbar: true })
    window.localStorage.setItem(SETTINGS_KEY, stored)
    expect(loadSettings()).toEqual({ settings: { ...DEFAULT_SETTINGS, theme: 'default', cellSize: 'double', nativeWidth: 9, columns: 132, ansiMode: 'ice', collapseHeader: true, iconOnlyToolbar: true } })
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBe(stored)
  })

  it.each(['default', 'light', 'midnight', 'forest', 'amber'] as const)('round-trips the %s theme', theme => {
    saveSettings({ ...DEFAULT_SETTINGS, theme })
    expect(loadSettings()).toEqual({ settings: { ...DEFAULT_SETTINGS, theme } })
  })

  it.each([
    '{', 'null', '[]', '"text"', 'x'.repeat(1025),
    JSON.stringify({ version: 4, ...DEFAULT_SETTINGS }),
    JSON.stringify({ version: 1, ...DEFAULT_SETTINGS }),
    JSON.stringify({ version: 3, ...DEFAULT_SETTINGS, collapseHeader: undefined }),
    JSON.stringify({ version: 3, ...DEFAULT_SETTINGS, theme: undefined }),
    ...[
      { font: 'remote-font' }, { cellSize: 'huge' }, { nativeWidth: 10 },
      { columns: 0 }, { columns: 513 }, { columns: 1.5 }, { columns: '80' },
      { ansiMode: 'tundra' }, { token: 'unexpected' },
      { collapseHeader: 'true' }, { iconOnlyToolbar: 1 },
      { theme: 'unknown' }, { theme: null }, { theme: 1 },
    ].map(change => JSON.stringify({ version: 3, ...DEFAULT_SETTINGS, ...change })),
  ])('rejects malformed, unsupported or out-of-range storage: %s', value => {
    window.localStorage.setItem(SETTINGS_KEY, value)
    const result = loadSettings()
    expect(result.settings).toEqual(DEFAULT_SETTINGS)
    expect(result.error?.message).toContain('Settings could not be loaded')
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBe(value)
  })
})
