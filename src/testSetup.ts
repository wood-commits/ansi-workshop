import { beforeEach, vi } from 'vitest'
import type {} from 'vitest/jsdom'

beforeEach(() => {
  if (typeof jsdom === 'undefined') return
  // Use browser storage, not Node's experimental localStorage global.
  vi.stubGlobal('localStorage', jsdom.window.localStorage)
  window.localStorage.clear()
})
