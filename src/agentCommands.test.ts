import { describe, expect, it } from 'vitest'
import { AgentCommandSchema, DrawInputSchema, MAX_AGENT_CELLS, MAX_READ_CELLS, ReadInputSchema } from './agentProtocol'
import { executeAgentCommand } from './agentCommands'
import { Editor } from './model'

const documentId = '95dcb355-4873-4405-a61d-5e1b076cb1dd'
const cell = { x: 0, y: 1_000_000_000, code: 219, fg: 14, bg: 1 }
const draw = (cells = [cell], expectedRevision = 0) => ({ type: 'draw', input: { documentId, expectedRevision, cells } })
describe('agent command boundary', () => {
  it('applies a sparse draw as a single undo step and reports its revision', () => {
    const editor = new Editor()
    const result = executeAgentCommand(editor, documentId, 0, draw([cell, { ...cell, x: 79 }]))
    expect(result).toEqual({ ok: true, documentId, revision: 1 })
    expect(editor.cells.size).toBe(2)
    expect(editor.dirty).toBe(true)
    editor.undo()
    expect(editor.cells.size).toBe(0)
    expect(editor.canUndo).toBe(false)
    editor.redo()
    expect(editor.cells.size).toBe(2)
  })
  it('reads blank and painted cells with document identity and revision', () => {
    const editor = new Editor()
    executeAgentCommand(editor, documentId, 0, draw())
    const result = executeAgentCommand(editor, documentId, 1, {
      type: 'read', input: { x: 0, y: cell.y, width: 2, height: 1 },
    })
    expect(result).toEqual({
      ok: true, documentId, revision: 1,
      cells: [cell, { x: 1, y: cell.y, code: 32, fg: 7, bg: 0 }],
    })
  })
  it('rejects stale document/revision without changes', () => {
    const editor = new Editor()
    expect(executeAgentCommand(editor, documentId, 1, draw()).ok).toBe(false)
    expect(executeAgentCommand(editor, crypto.randomUUID(), 0, draw()).ok).toBe(false)
    expect(editor.cells.size).toBe(0)
    expect(editor.canUndo).toBe(false)
  })
  it('validates the entire batch before making any change', () => {
    const editor = new Editor()
    for (const invalid of [{ ...cell, code: 27 }, { ...cell, bg: 8 }, { ...cell, fg: 16 }, { ...cell, x: 80 }, { ...cell, y: Infinity }]) {
      expect(() => executeAgentCommand(editor, documentId, 0, draw([cell, invalid]))).toThrow()
      expect(editor.cells.size).toBe(0)
    }
    expect(AgentCommandSchema.safeParse({ type: 'save', path: 'screen.ans' }).success).toBe(false)
    expect(DrawInputSchema.safeParse({ ...draw().input, script: 'ignored?' }).success).toBe(false)
  })
  it('enforces exact draw/read batch limits and safe coordinate arithmetic', () => {
    expect(DrawInputSchema.safeParse(draw(Array.from({ length: MAX_AGENT_CELLS }, () => cell)).input).success).toBe(true)
    expect(DrawInputSchema.safeParse(draw(Array.from({ length: MAX_AGENT_CELLS + 1 }, () => cell)).input).success).toBe(false)
    expect(ReadInputSchema.safeParse({ x: 0, y: 0, width: 1, height: MAX_READ_CELLS }).success).toBe(true)
    for (const input of [
      { x: 0, y: 0, width: 1, height: MAX_READ_CELLS + 1 },
      { x: 0, y: 0, width: 80, height: 26 },
      { x: 79, y: 0, width: 2, height: 1 },
      { x: 0, y: Number.MAX_SAFE_INTEGER - 1000, width: 1, height: 2 },
    ]) expect(ReadInputSchema.safeParse(input).success).toBe(false)
  })
})
