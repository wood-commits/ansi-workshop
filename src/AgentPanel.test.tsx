import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AgentPanel } from './AgentPanel'
import { OwnerRequestSchema, type AgentJob } from './agentProtocol'

const ownerKey = 'a'.repeat(64), agentToken = 'b'.repeat(64)
const documentId = '95dcb355-4873-4405-a61d-5e1b076cb1dd'
const grantId = 'b8a7a4fd-71fd-44db-b53d-50b95d018a6c'
let grants: { id: string; name: string; expiresAt: number }[]
let job: AgentJob | undefined
let failPoll = false
let requests: ReturnType<typeof OwnerRequestSchema.parse>[]
beforeEach(() => {
  grants = []; requests = []; job = undefined; failPoll = false
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = OwnerRequestSchema.parse(JSON.parse(String(init.body)))
    requests.push(body)
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${ownerKey}`)
    if (body.action === 'poll' && failPoll) return new Response(JSON.stringify({ error: 'Broker disconnected.' }), { status: 409 })
    if (body.action === 'detach') return new Response(JSON.stringify({ detached: true }))
    let token: string | undefined
    if (body.action === 'grant') { grants = [{ id: grantId, name: body.name, expiresAt: Date.now() + 1800_000 }]; token = agentToken }
    if (body.action === 'revoke') grants = []
    const next = body.action === 'poll' ? job : undefined
    if (body.action === 'poll') job = undefined
    return new Response(JSON.stringify({ documentId, grants, job: next, token }))
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function enable() {
  fireEvent.click(screen.getByText('Agent access'))
  fireEvent.change(screen.getByLabelText('Owner key (never share with agents)'), { target: { value: ownerKey } })
  fireEvent.click(screen.getByRole('button', { name: 'Enable agent access' }))
  await screen.findByLabelText('Agent label (for your reference)')
}
describe('human agent approval controls', () => {
  it('is off and makes no network requests until explicitly enabled', () => {
    render(<AgentPanel onCommand={vi.fn()} />)
    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Agent access'))
    fireEvent.click(screen.getByRole('button', { name: 'Enable agent access' }))
    expect(screen.getByRole('alert').textContent).toContain('64-character owner key')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('requires confirmation, issues a separate token, supports hiding and revocation', async () => {
    render(<AgentPanel onCommand={vi.fn()} />)
    await enable()
    fireEvent.change(screen.getByLabelText('Agent label (for your reference)'), { target: { value: 'My drawing agent' } })
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: 'Approve & issue token' }))
    expect(requests.some(request => request.action === 'grant')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Approve & issue token' }))
    await screen.findByDisplayValue(agentToken)
    expect(screen.queryByDisplayValue(ownerKey)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Hide token' }))
    expect(screen.queryByDisplayValue(agentToken)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke My drawing agent' }))
    await waitFor(() => expect(requests.some(request => request.action === 'revoke')).toBe(true))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Revoke My drawing agent' })).toBeNull())
  })
  it('applies a delivered command once and acknowledges the actual editor result', async () => {
    job = { id: crypto.randomUUID(), agent: 'Approved', command: { type: 'read', input: { x: 0, y: 0, width: 1, height: 1 } } }
    const result = { ok: true as const, documentId, revision: 12, cells: [] }
    const execute = vi.fn().mockReturnValue(result)
    render(<AgentPanel onCommand={execute} />)
    await enable()
    await waitFor(() => expect(requests.some(request => request.action === 'result')).toBe(true))
    expect(execute).toHaveBeenCalledOnce()
    expect(requests.find(request => request.action === 'result')).toEqual(expect.objectContaining({ result }))
  })
  it('disconnects and revokes on unmount/document replacement, without persisting keys', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    const view = render(<AgentPanel onCommand={vi.fn()} />)
    await enable()
    view.unmount()
    await waitFor(() => expect(requests.some(request => request.action === 'detach')).toBe(true))
    expect(storage).not.toHaveBeenCalled()
  })
  it('surfaces polling errors and disables access instead of silently retrying writes', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<AgentPanel onCommand={vi.fn()} />)
    await enable()
    failPoll = true
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Broker disconnected.'))
    expect(log).toHaveBeenCalled()
    expect(screen.getByLabelText('Owner key (never share with agents)')).not.toBeNull()
  })
})
