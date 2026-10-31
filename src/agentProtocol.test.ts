// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'

const originalJitless = z.config().jitless

beforeEach(() => vi.resetModules())
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  z.config({ jitless: originalJitless })
})

it.each([undefined, false, true])('preserves Node Zod configuration when jitless is %s', async jitless => {
  z.config({ jitless })
  expect(typeof window).toBe('undefined')
  const { AgentCellSchema } = await import('./agentProtocol')
  expect(z.config().jitless).toBe(jitless)
  expect(AgentCellSchema.safeParse({ x: 0, y: 0, code: 219, fg: 7, bg: 0 }).success).toBe(true)
})

it('constructs and validates browser schemas without attempting dynamic code generation', async () => {
  vi.stubGlobal('window', {})
  z.config({ jitless: false })
  const dynamicCode = vi.spyOn(globalThis, 'Function').mockImplementation(() => {
    throw new Error('Dynamic code generation is blocked by CSP.')
  })
  const { AgentCellSchema, ReadInputSchema } = await import('./agentProtocol')
  expect(z.config().jitless).toBe(true)
  expect(AgentCellSchema.safeParse({ x: 79, y: 1_000_000_000, code: 255, fg: 15, bg: 7 }).success).toBe(true)
  expect(AgentCellSchema.safeParse({ x: 80, y: 0, code: 27, fg: 16, bg: 8 }).success).toBe(false)
  expect(AgentCellSchema.safeParse({ x: 0, y: 0, code: 219, fg: 7, bg: 0, extra: true }).success).toBe(false)
  expect(ReadInputSchema.safeParse({ x: 79, y: 0, width: 2, height: 1 }).success).toBe(false)
  expect(dynamicCode).not.toHaveBeenCalled()
})
