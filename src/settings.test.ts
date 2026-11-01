import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, SETTINGS_KEY } from './settings'

describe('local Settings storage', () => {
  it('uses defaults when absent and writes only the versioned preference whitelist', () => {
    window.localStorage.clear()
    expect(loadSettings()).toEqual({ settings: DEFAULT_SETTINGS })
    const settings = { ...DEFAULT_SETTINGS, columns: 512, art: 'not stored', token: 'not stored' }
    saveSettings(settings)
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY)!)).toEqual({ version: 1, ...DEFAULT_SETTINGS, columns: 512 })
    expect(loadSettings()).toEqual({ settings: { ...DEFAULT_SETTINGS, columns: 512 } })
  })

  it.each([
    '{', 'null', '[]', '"text"', 'x'.repeat(1025),
    JSON.stringify({ version: 2, ...DEFAULT_SETTINGS }),
    ...[
      { font: 'remote-font' }, { cellSize: 'huge' }, { nativeWidth: 10 },
      { columns: 0 }, { columns: 513 }, { columns: 1.5 }, { columns: '80' },
      { ansiMode: 'tundra' }, { token: 'unexpected' },
    ].map(change => JSON.stringify({ version: 1, ...DEFAULT_SETTINGS, ...change })),
  ])('rejects malformed, unsupported or out-of-range storage: %s', value => {
    window.localStorage.setItem(SETTINGS_KEY, value)
    const result = loadSettings()
    expect(result.settings).toEqual(DEFAULT_SETTINGS)
    expect(result.error?.message).toContain('Settings could not be loaded')
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBe(value)
  })
})
