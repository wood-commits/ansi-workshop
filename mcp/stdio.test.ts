// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { expect, it } from 'vitest'
import { BROKER_PORT, createBroker, newToken } from './broker'
import { AgentResultSchema, OwnerResponseSchema } from '../src/agentProtocol'
import { executeAgentCommand } from '../src/agentCommands'
import { Editor } from '../src/model'

it('speaks real MCP stdio, gates reads/writes by approval, and revokes an existing client', async () => {
  const ownerToken = newToken(), clientId = randomUUID()
  const broker = createBroker(ownerToken)
  await new Promise<void>((success, failure) => {
    broker.once('error', failure)
    broker.listen(BROKER_PORT, '127.0.0.1', success)
  })
  const owner = async (input: Record<string, unknown>) => {
    const response = await fetch(`http://127.0.0.1:${BROKER_PORT}/owner`, {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:5173', Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, ...input }),
    })
    expect(response.status).toBe(200)
    return OwnerResponseSchema.parse(await response.json())
  }
  const editor = new Editor()
  let revision = 0
  const transport = (token: string) => new StdioClientTransport({
    command: process.execPath,
    args: [resolve('build-mcp', 'mcp', 'stdio.js')],
    env: { ANSI_WORKSHOP_AGENT_TOKEN: token },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'integration-test', version: '1.0.0' })
  const denied = new Client({ name: 'unapproved-test', version: '1.0.0' })
  let running = true
  let polling: Promise<void> | undefined
  try {
    await owner({ action: 'attach' })
    const approved = await owner({ action: 'grant', name: 'Integration test' })
    await client.connect(transport(approved.token!))
    await denied.connect(transport(newToken()))
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual(['draw_cells', 'read_region'])
    expect((await denied.callTool({ name: 'read_region', arguments: { x: 0, y: 0, width: 1, height: 1 } })).isError).toBe(true)
    polling = (async () => {
      while (running) {
        const state = await owner({ action: 'poll' })
        if (state.job) {
          const result = executeAgentCommand(editor, state.documentId, revision, state.job.command)
          if (result.ok && state.job.command.type === 'draw') revision = result.revision
          await owner({ action: 'result', id: state.job.id, result })
        }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    })()
    const readResult = await client.callTool({ name: 'read_region', arguments: { x: 0, y: 1_000_000_000, width: 2, height: 1 } })
    const content = readResult.content
    if (!Array.isArray(content) || content[0]?.type !== 'text') throw new Error('Expected MCP text result.')
    const read = AgentResultSchema.parse(JSON.parse(content[0].text))
    if (!read.ok) throw new Error('Expected authorized read success.')
    const arguments_ = {
      documentId: read.documentId, expectedRevision: read.revision,
      cells: [{ x: 0, y: 1_000_000_000, code: 219, fg: 14, bg: 1 }],
    }
    expect((await client.callTool({ name: 'draw_cells', arguments: arguments_ })).isError).toBe(false)
    expect(editor.cells.size).toBe(1)
    expect(editor.cell({ x: 0, y: 1_000_000_000 }).code).toBe(219)
    expect((await client.callTool({ name: 'draw_cells', arguments: arguments_ })).isError).toBe(true)
    await owner({ action: 'revoke', id: approved.grants[0].id })
    expect((await client.callTool({ name: 'read_region', arguments: { x: 0, y: 0, width: 1, height: 1 } })).isError).toBe(true)
    editor.undo()
    expect(editor.cells.size).toBe(0)
  } finally {
    running = false
    if (polling) await polling
    await Promise.all([client.close(), denied.close()])
    broker.closeAllConnections()
    await new Promise<void>(resolve => broker.close(() => resolve()))
  }
}, 15_000)
