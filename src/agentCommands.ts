import { AgentCommandSchema, type AgentResult } from './agentProtocol'
import type { Editor } from './model'

export function executeAgentCommand(
  editor: Editor, documentId: string, revision: number, input: unknown,
): AgentResult {
  if (editor.format !== 'ansi' || editor.width !== 80) return { ok: false, error: 'Agent access supports 80-column classic ANSI documents only.' }
  const command = AgentCommandSchema.parse(input)
  if (command.type === 'read') {
    const cells = []
    const { x, y, width, height } = command.input
    for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) {
      cells.push({ x: column, y: row, ...editor.cell({ x: column, y: row }) })
    }
    return { ok: true, documentId, revision, cells }
  }
  if (command.input.documentId !== documentId) return { ok: false, error: 'Document changed. Read the canvas again before drawing.' }
  if (command.input.expectedRevision !== revision) return { ok: false, error: 'Revision conflict. Read the canvas again before drawing.' }
  editor.commit()
  for (const { x, y, code, fg, bg } of command.input.cells) editor.paint({ x, y }, { code, fg, bg })
  editor.commit()
  return { ok: true, documentId, revision: revision + 1 }
}
