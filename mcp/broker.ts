import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  AgentCommandSchema, OwnerRequestSchema, type AgentCommand, type AgentJob, type AgentResult,
} from '../src/agentProtocol.js'

export const BROKER_PORT = 47831
export const OWNER_LEASE_MS = 15_000
export const GRANT_TTL_MS = 30 * 60_000
const MAX_BODY_BYTES = 256 * 1024
const ORIGINS = new Set([
  'http://127.0.0.1:5173', 'http://localhost:5173',
  'http://127.0.0.1:4173', 'http://localhost:4173',
])
const hash = (value: string) => createHash('sha256').update(value).digest()
export const newToken = () => randomBytes(32).toString('hex')
class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
interface Grant {
  id: string
  name: string
  digest: string
  expiresAt: number
  windowStart: number
  calls: number
}
interface Pending {
  job: AgentJob
  grantId: string
  delivered: boolean
  resolve(result: AgentResult): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

function readJson(request: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'Use application/json.')
  }
  if (Number(request.headers['content-length'] ?? 0) > MAX_BODY_BYTES) throw new HttpError(413, 'Request exceeds 256 KiB.')
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let overflow = false
    request.on('data', (chunk: Buffer) => {
      if (overflow) return
      bytes += chunk.length
      if (bytes > MAX_BODY_BYTES) {
        overflow = true
        reject(new HttpError(413, 'Request exceeds 256 KiB.'))
      } else chunks.push(chunk)
    })
    request.on('end', () => {
      if (overflow) return
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (cause) { reject(new HttpError(400, cause instanceof SyntaxError ? 'Malformed JSON.' : 'Cannot read request.')) }
    })
    request.on('error', reject)
    request.on('aborted', () => reject(new HttpError(400, 'Request aborted.')))
  })
}

export function createBroker(ownerToken: string) {
  const ownerDigest = hash(ownerToken)
  let session: { clientId: string; documentId: string; lastPoll: number } | undefined
  const grants = new Map<string, Grant>()
  const pending = new Map<string, Pending>()
  const finish = (id: string, result?: AgentResult, error?: Error) => {
    const operation = pending.get(id)
    if (!operation) return
    pending.delete(id)
    clearTimeout(operation.timer)
    if (error) operation.reject(error)
    else if (result) operation.resolve(result)
  }
  const revoke = (id: string) => {
    grants.delete(id)
    for (const [jobId, operation] of pending) {
      if (operation.grantId === id) finish(jobId, undefined, new HttpError(403, 'Agent permission revoked or expired.'))
    }
  }
  const detach = () => {
    for (const id of grants.keys()) revoke(id)
    session = undefined
  }
  const sweep = () => {
    const now = Date.now()
    if (session && now - session.lastPoll > OWNER_LEASE_MS) detach()
    for (const [id, grant] of grants) if (now >= grant.expiresAt) revoke(id)
  }
  const publicState = () => ({
    documentId: session!.documentId,
    grants: [...grants.values()].map(({ id, name, expiresAt }) => ({ id, name, expiresAt })),
  })
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Connection', 'close')
    const address = server.address()
    const port = address && typeof address !== 'string' ? address.port : BROKER_PORT
    if (request.headers.host !== `127.0.0.1:${port}`) throw new HttpError(403, 'Host not allowed.')
    const ownerRoute = request.url === '/owner'
    if (!ownerRoute && request.url !== '/agent') throw new HttpError(404, 'Not found.')
    const origin = request.headers.origin
    if (ownerRoute) {
      if (!origin || !ORIGINS.has(origin)) throw new HttpError(403, 'Editor origin not allowed.')
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Vary', 'Origin')
      if (request.method === 'OPTIONS') {
        if (request.headers['access-control-request-method'] !== 'POST' ||
            (request.headers['access-control-request-headers'] ?? '').split(',').some(value => !['authorization', 'content-type'].includes(value.trim().toLowerCase()))) {
          throw new HttpError(403, 'Preflight not allowed.')
        }
        response.setHeader('Access-Control-Allow-Methods', 'POST')
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        response.writeHead(204).end()
        return
      }
    } else if (origin !== undefined) throw new HttpError(403, 'Browser access to agent transport is not allowed.')
    if (request.method !== 'POST') throw new HttpError(405, 'Use POST.')
    const authorization = request.headers.authorization ?? ''
    if (!/^Bearer [a-f0-9]{64}$/.test(authorization)) throw new HttpError(401, 'Authorization required.')
    const digest = hash(authorization.slice(7))
    sweep()
    let grant: Grant | undefined
    if (ownerRoute) {
      if (!timingSafeEqual(ownerDigest, digest)) throw new HttpError(401, 'Authorization failed.')
    } else {
      grant = [...grants.values()].find(value => value.digest === digest.toString('hex'))
      if (!grant) throw new HttpError(403, 'Agent is not approved or approval has expired.')
      const now = Date.now()
      if (now - grant.windowStart >= 1000) { grant.windowStart = now; grant.calls = 0 }
      if (++grant.calls > 10) throw new HttpError(429, 'Maximum 10 calls per second per agent.')
    }
    const body = await readJson(request)
    // Permission may have been revoked while the request body was arriving.
    sweep()
    if (ownerRoute) {
      const parsed = OwnerRequestSchema.safeParse(body)
      if (!parsed.success) throw new HttpError(400, 'Invalid owner request.')
      const input = parsed.data
      if (input.action === 'attach') {
        if (session && session.clientId !== input.clientId) throw new HttpError(409, 'Another editor is already connected. Disconnect it first or wait for its lease to expire.')
        session ??= { clientId: input.clientId, documentId: randomUUID(), lastPoll: Date.now() }
      } else if (!session || input.clientId !== session.clientId) {
        throw new HttpError(409, 'Editor lease expired. Reconnect and approve agents again.')
      }
      session!.lastPoll = Date.now()
      if (input.action === 'detach') {
        detach()
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ detached: true }))
        return
      }
      let token: string | undefined
      if (input.action === 'grant') {
        if (grants.size >= 16) throw new HttpError(429, 'At most 16 approved agents; revoke one first.')
        token = newToken()
        const id = randomUUID()
        grants.set(id, { id, name: input.name, digest: hash(token).toString('hex'), expiresAt: Date.now() + GRANT_TTL_MS, windowStart: Date.now(), calls: 0 })
      }
      if (input.action === 'revoke') revoke(input.id)
      if (input.action === 'result') {
        const operation = pending.get(input.id)
        if (!operation || !operation.delivered) throw new HttpError(409, 'Operation expired or was revoked. Its outcome may be unknown; do not retry writes blindly.')
        finish(input.id, input.result)
      }
      let job: AgentJob | undefined
      if (input.action === 'poll') {
        const next = [...pending.values()].find(value => !value.delivered)
        if (next) { next.delivered = true; job = next.job }
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ...publicState(), job, token }))
      return
    }
    if (!grant || !grants.has(grant.id) || !session) throw new HttpError(403, 'Agent permission revoked or editor disconnected.')
    const command = AgentCommandSchema.safeParse(body)
    if (!command.success) throw new HttpError(400, 'Invalid command, coordinates, colors, or batch size.')
    if (pending.size >= 16 || [...pending.values()].some(value => value.grantId === grant.id)) throw new HttpError(429, 'Only one outstanding call per agent is allowed.')
    const result = await enqueue(grant, command.data, response)
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result))
  }
  const enqueue = (grant: Grant, command: AgentCommand, response: ServerResponse) => new Promise<AgentResult>((resolve, reject) => {
    const id = randomUUID()
    const timer = setTimeout(() => finish(id, undefined, new HttpError(408, 'Editor did not acknowledge within 10 seconds. Outcome may be unknown; read before retrying.')), 10_000)
    pending.set(id, { job: { id, agent: grant.name, command }, grantId: grant.id, delivered: false, resolve, reject, timer })
    response.once('close', () => finish(id, undefined, new HttpError(408, 'Agent disconnected; outcome may be unknown.')))
  })
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, (request, response) => {
    void handle(request, response).catch((cause: unknown) => {
      const status = cause instanceof HttpError ? cause.status : 500
      if (status === 500) console.error('Agent broker request failed:', cause instanceof Error ? cause.name : 'Unknown error')
      if (!response.destroyed && !response.headersSent) {
        response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          error: cause instanceof HttpError ? cause.message : 'Internal broker error.',
        }))
        request.resume()
      }
    })
  })
  server.maxConnections = 32
  server.keepAliveTimeout = 1000
  const interval = setInterval(sweep, 1000)
  interval.unref()
  server.on('close', () => { clearInterval(interval); detach() })
  return server
}
