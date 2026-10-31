import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  BROKER_URL, OwnerResponseSchema, type AgentCommand, type AgentResult, type OwnerResponse,
} from './agentProtocol'

async function ownerRequest(key: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${BROKER_URL}/owner`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
  })
  const result: unknown = await response.json()
  if (!response.ok) {
    const message = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
      ? result.error : `Agent broker rejected the request (HTTP ${response.status}).`
    throw new Error(message)
  }
  return result
}

export function AgentPanel({ onCommand }: {
  onCommand(documentId: string, command: AgentCommand): AgentResult
}) {
  const [ownerKey, setOwnerKey] = useState('')
  const [connection, setConnection] = useState<{ key: string; clientId: string }>()
  const [state, setState] = useState<OwnerResponse>()
  const [agentName, setAgentName] = useState('')
  const [issuedToken, setIssuedToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | undefined>(undefined)
  const execute = useEffectEvent((documentId: string, command: AgentCommand) => onCommand(documentId, command))
  const report = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : 'Agent connection failed.'
    console.error('Agent access:', message)
    setError(message)
  }

  useEffect(() => {
    if (!connection) return
    const abort = new AbortController()
    controller.current = abort
    const request = (body: Record<string, unknown>) => ownerRequest(connection.key, { clientId: connection.clientId, ...body }, abort.signal)
    const run = async () => {
      try {
        const attached = OwnerResponseSchema.parse(await request({ action: 'attach' }))
        if (abort.signal.aborted) return
        setState(attached)
        while (!abort.signal.aborted) {
          const next = OwnerResponseSchema.parse(await request({ action: 'poll' }))
          if (abort.signal.aborted) return
          setState(next)
          if (next.job) {
            let result: AgentResult
            try { result = execute(next.documentId, next.job.command) }
            catch (cause) {
              report(cause)
              result = { ok: false, error: 'Editor rejected the operation. See the local editor for details.' }
            }
            await request({ action: 'result', id: next.job.id, result })
          }
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      } catch (cause) {
        if (!abort.signal.aborted) {
          report(cause)
          setConnection(undefined); setState(undefined); setIssuedToken('')
        }
      }
    }
    void run()
    return () => {
      abort.abort()
      controller.current = undefined
      void ownerRequest(connection.key, { action: 'detach', clientId: connection.clientId }, AbortSignal.timeout(2000))
        .catch(() => console.warn('Agent broker disconnect was not acknowledged; the lease will revoke access within 15 seconds.'))
    }
  }, [connection])

  const disconnect = () => {
    controller.current?.abort()
    setConnection(undefined); setState(undefined); setIssuedToken('')
  }
  const manage = async (action: 'grant' | 'revoke', id?: string) => {
    if (!connection || !controller.current || busy) return
    const signal = controller.current.signal
    setBusy(true); setError(''); setIssuedToken('')
    try {
      const request = action === 'grant'
        ? { action, clientId: connection.clientId, name: agentName }
        : { action, clientId: connection.clientId, id }
      const response = OwnerResponseSchema.parse(await ownerRequest(connection.key, request, signal))
      if (signal.aborted) return
      setState(response)
      if (response.token) { setIssuedToken(response.token); setAgentName('') }
    } catch (cause) { if (!signal.aborted) report(cause) }
    finally { setBusy(false) }
  }
  return <details className="panel agent-panel">
    <summary>Agent access <span>{state ? `${state.grants.length} approved` : connection ? 'Connecting…' : 'Off'}</span></summary>
    <p>Optional local MCP access. Approved agents can read and overwrite this screen, but cannot save files. Tokens identify their holder, not an AI model.</p>
    {!connection ? <form onSubmit={event => {
      event.preventDefault()
      if (!/^[a-f0-9]{64}$/.test(ownerKey)) { setError('Enter the 64-character owner key printed by npm run agents.'); return }
      setError('')
      setConnection({ key: ownerKey, clientId: crypto.randomUUID() })
      setOwnerKey('')
    }}>
      <label htmlFor="agent-owner-key">Owner key (never share with agents)</label>
      <input id="agent-owner-key" type="password" autoComplete="off" spellCheck={false} value={ownerKey} onChange={event => setOwnerKey(event.target.value)} />
      <button type="submit">Enable agent access</button>
      <p>Start <code>npm run agents</code> in a separate terminal first. The key stays in page memory only.</p>
    </form> : <>
      <button className="disconnect-agents" onClick={disconnect}>Disconnect & revoke all</button>
      {state && <form onSubmit={event => {
        event.preventDefault()
        if (window.confirm(`Allow "${agentName.trim()}" to read and overwrite this document for up to 30 minutes? Only give the resulting token to the intended agent client.`)) void manage('grant')
      }}>
        <label htmlFor="agent-name">Agent label (for your reference)</label>
        <input id="agent-name" maxLength={60} required value={agentName} onChange={event => setAgentName(event.target.value)} />
        <button type="submit" disabled={busy || !agentName.trim() || state.grants.length >= 16}>Approve & issue token</button>
      </form>}
      {issuedToken && <div className="issued-token">
        <label htmlFor="issued-agent-token">Agent token — shown only now</label>
        <textarea id="issued-agent-token" readOnly spellCheck={false} value={issuedToken} />
        <p>Set ANSI_WORKSHOP_AGENT_TOKEN in the intended MCP client's environment. Do not put tokens in source control or chat.</p>
        <button onClick={() => setIssuedToken('')}>Hide token</button>
      </div>}
      {state && <ul aria-label="Approved agents">{state.grants.map(grant => <li key={grant.id}>
        <span>{grant.name}<small>Expires {new Date(grant.expiresAt).toLocaleTimeString()}</small></span>
        <button disabled={busy} onClick={() => void manage('revoke', grant.id)} aria-label={`Revoke ${grant.name}`}>Revoke</button>
      </li>)}</ul>}
      <p>New, page close, disconnect, or a 15-second missed heartbeat revokes approvals. Undo reverses agent edits.</p>
    </>}
    {error && <p role="alert" className="agent-error">{error}</p>}
  </details>
}
