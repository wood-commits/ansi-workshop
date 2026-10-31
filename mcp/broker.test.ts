// @vitest-environment node
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBroker, GRANT_TTL_MS, newToken, OWNER_LEASE_MS } from './broker'
import { OwnerResponseSchema } from '../src/agentProtocol'

let server: ReturnType<typeof createBroker>
let base: string
let key: string
let clientId: string
const origin = 'http://127.0.0.1:5173'
const read = { type: 'read', input: { x: 0, y: 0, width: 1, height: 1 } }
function post(path: string, token: string, body: unknown, from?: string) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(from ? { Origin: from } : {}) },
    body: JSON.stringify(body),
  })
}
const owner = (body: Record<string, unknown>) => post('/owner', key, { clientId, ...body }, origin)
async function attach() {
  const response = await owner({ action: 'attach' })
  expect(response.status).toBe(200)
  return OwnerResponseSchema.parse(await response.json())
}
async function grant(name = 'Approved test agent') {
  const response = await owner({ action: 'grant', name })
  expect(response.status).toBe(200)
  const state = OwnerResponseSchema.parse(await response.json())
  return { token: state.token!, id: state.grants.at(-1)!.id }
}
beforeEach(async () => {
  key = newToken(); clientId = randomUUID()
  server = createBroker(key)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterEach(async () => {
  vi.restoreAllMocks()
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
})
describe('broker authorization and isolation', () => {
  it('rejects missing/wrong tokens and never accepts owner keys for agent calls', async () => {
    expect((await post('/owner', newToken(), { action: 'attach', clientId }, origin)).status).toBe(401)
    expect((await post('/owner', '', { action: 'attach', clientId }, origin)).status).toBe(401)
    expect((await post('/agent', newToken(), read)).status).toBe(403)
    expect((await post('/agent', key, read)).status).toBe(403)
    await attach()
    const approved = await grant()
    expect((await post('/owner', approved.token, { action: 'poll', clientId }, origin)).status).toBe(401)
  })
  it('requires an exact owner origin, rejects agent Origin headers, and restricts preflights', async () => {
    expect((await post('/owner', key, { action: 'attach', clientId })).status).toBe(403)
    expect((await post('/owner', key, { action: 'attach', clientId }, 'https://evil.invalid')).status).toBe(403)
    await attach()
    const approved = await grant()
    expect((await post('/agent', approved.token, read, origin)).status).toBe(403)
    const allowed = await fetch(`${base}/owner`, { method: 'OPTIONS', headers: {
      Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type',
    } })
    expect(allowed.status).toBe(204)
    expect(allowed.headers.get('access-control-allow-origin')).toBe(origin)
    const blocked = await fetch(`${base}/owner`, { method: 'OPTIONS', headers: {
      Origin: 'https://evil.invalid', 'Access-Control-Request-Method': 'POST',
    } })
    expect(blocked.status).toBe(403)
    expect(blocked.headers.has('access-control-allow-origin')).toBe(false)
  })
  it('rejects hostile Host headers using the actual HTTP Host field', async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = http.get(base, { headers: { Host: 'evil.invalid' } }, response => {
        response.resume(); resolve(response.statusCode)
      })
      request.on('error', reject)
    })
    expect(status).toBe(403)
  })
  it('accepts only one editor and does not expose tokens in listing responses', async () => {
    await attach()
    const approved = await grant()
    expect((await post('/owner', key, { action: 'attach', clientId: randomUUID() }, origin)).status).toBe(409)
    expect((await post('/owner', key, { action: 'poll', clientId: randomUUID() }, origin)).status).toBe(409)
    const poll = await owner({ action: 'poll' })
    const text = await poll.text()
    expect(text).not.toContain(approved.token)
    expect(text).not.toContain(key)
    expect(poll.headers.get('cache-control')).toBe('no-store')
    expect(poll.headers.get('x-content-type-options')).toBe('nosniff')
  })
  it('delivers an approved job only once and returns success only after editor acknowledgment', async () => {
    const session = await attach()
    const approved = await grant()
    let completed = false
    const request = post('/agent', approved.token, read).then(response => { completed = true; return response })
    const poll = await pollJob()
    expect(poll.job?.agent).toBe('Approved test agent')
    expect(completed).toBe(false)
    const second = OwnerResponseSchema.parse(await (await owner({ action: 'poll' })).json())
    expect(second.job).toBeUndefined()
    const result = { ok: true, documentId: session.documentId, revision: 0, cells: [] }
    expect((await owner({ action: 'result', id: poll.job!.id, result })).status).toBe(200)
    expect(await (await request).json()).toEqual(result)
    expect((await owner({ action: 'result', id: poll.job!.id, result })).status).toBe(409)
  })
  it('revokes active/queued calls and invalidates tokens on disconnect/new session', async () => {
    const old = await attach()
    const approved = await grant()
    const request = post('/agent', approved.token, read)
    await pollJob()
    await owner({ action: 'revoke', id: approved.id })
    expect((await request).status).toBe(403)
    expect((await post('/agent', approved.token, read)).status).toBe(403)
    const next = await grant()
    await owner({ action: 'detach' })
    expect((await post('/agent', next.token, read)).status).toBe(403)
    expect((await attach()).documentId).not.toBe(old.documentId)
  })
  it('expires disconnected editor leases and gives approvals a 30-minute lifetime', async () => {
    await attach()
    const approved = await grant()
    const state = OwnerResponseSchema.parse(await (await owner({ action: 'poll' })).json())
    expect(state.grants[0].expiresAt - Date.now()).toBeGreaterThan(GRANT_TTL_MS - 1000)
    const future = Date.now() + OWNER_LEASE_MS + 1
    vi.spyOn(Date, 'now').mockReturnValue(future)
    expect((await post('/agent', approved.token, read)).status).toBe(403)
    expect((await owner({ action: 'poll' })).status).toBe(409)
  })
  it('expires an agent token even if the editor continuously renews its lease', async () => {
    await attach()
    const approved = await grant()
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    for (let elapsed = 0; elapsed <= GRANT_TTL_MS; elapsed += 10_000) {
      now += 10_000
      expect((await owner({ action: 'poll' })).status).toBe(200)
    }
    expect((await post('/agent', approved.token, read)).status).toBe(403)
  })
  it('limits grants to 16 and allows replacement only after revocation', async () => {
    await attach()
    const first = await grant('First')
    for (let index = 1; index < 16; index++) await grant(`Agent ${index}`)
    expect((await owner({ action: 'grant', name: 'Too many' })).status).toBe(429)
    expect(server.maxConnections).toBe(32)
    await owner({ action: 'revoke', id: first.id })
    expect((await owner({ action: 'grant', name: 'Replacement' })).status).toBe(200)
  })
  it('reports an unknown outcome on timeout and never redelivers the job', async () => {
    const session = await attach()
    const approved = await grant()
    const request = post('/agent', approved.token, read)
    const delivered = await pollJob()
    const response = await request
    expect(response.status).toBe(408)
    expect((await response.json()).error).toContain('Outcome may be unknown')
    const poll = OwnerResponseSchema.parse(await (await owner({ action: 'poll' })).json())
    expect(poll.job).toBeUndefined()
    const result = { ok: true, documentId: session.documentId, revision: 0 }
    expect((await owner({ action: 'result', id: delivered.job!.id, result })).status).toBe(409)
  }, 15_000)
  it('limits concurrency per token and permits separately approved agents', async () => {
    await attach()
    const a = await grant('A'), b = await grant('B')
    const request = post('/agent', a.token, read)
    await pollJob()
    expect((await post('/agent', a.token, read)).status).toBe(429)
    const other = post('/agent', b.token, read)
    const job = await pollJob()
    expect(job.job?.agent).toBe('B')
    await owner({ action: 'detach' })
    expect((await request).status).toBe(403)
    expect((await other).status).toBe(403)
  })
  it('rejects malformed, oversized and out-of-scope requests', async () => {
    await attach()
    const approved = await grant()
    expect((await post('/agent', approved.token, { type: 'save', path: 'anything' })).status).toBe(400)
    expect((await post('/agent', approved.token, { type: 'draw', input: { cells: [] } })).status).toBe(400)
    expect((await post('/agent', approved.token, 'x'.repeat(256 * 1024))).status).toBe(413)
    const malformed = await fetch(`${base}/agent`, { method: 'POST', headers: {
      Authorization: `Bearer ${approved.token}`, 'Content-Type': 'application/json',
    }, body: '{invalid' })
    expect(malformed.status).toBe(400)
    const simple = await fetch(`${base}/agent`, { method: 'POST', headers: { Authorization: `Bearer ${approved.token}` }, body: 'text' })
    expect(simple.status).toBe(415)
    expect((await post('/filesystem', key, {})).status).toBe(404)
  })
  it('enforces the body limit for chunked uploads without trusting Content-Length', async () => {
    await attach()
    const approved = await grant()
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = http.request(`${base}/agent`, { method: 'POST', headers: {
        Authorization: `Bearer ${approved.token}`, 'Content-Type': 'application/json',
      } }, response => { response.resume(); resolve(response.statusCode) })
      request.on('error', reject)
      request.write(' '.repeat(100 * 1024))
      request.write(' '.repeat(100 * 1024))
      request.end(' '.repeat(100 * 1024))
    })
    expect(status).toBe(413)
  })
  it('enforces the rate limit even for invalid authenticated commands', async () => {
    await attach()
    const approved = await grant()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now())
    for (let call = 0; call < 10; call++) expect((await post('/agent', approved.token, {})).status).toBe(400)
    expect((await post('/agent', approved.token, {})).status).toBe(429)
  })
})

async function pollJob() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await owner({ action: 'poll' })
    const value = OwnerResponseSchema.parse(await response.json())
    if (value.job) return value
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Expected queued job was not delivered.')
}
