import { z } from 'zod'

export const BROKER_URL = 'http://127.0.0.1:47831'
export const MAX_AGENT_CELLS = 1024
export const MAX_READ_CELLS = 2048
export const MAX_AGENT_ROW = Number.MAX_SAFE_INTEGER - 1000
const coordinate = z.number().int().min(0).max(MAX_AGENT_ROW)
export const AgentCellSchema = z.strictObject({
  x: z.number().int().min(0).max(79),
  y: coordinate,
  code: z.number().int().min(32).max(255),
  fg: z.number().int().min(0).max(15),
  bg: z.number().int().min(0).max(7),
})
export const ReadInputSchema = z.strictObject({
  x: z.number().int().min(0).max(79),
  y: coordinate,
  width: z.number().int().min(1).max(80),
  height: z.number().int().min(1).max(MAX_READ_CELLS),
}).refine(value => value.x + value.width <= 80 && value.y + value.height - 1 <= MAX_AGENT_ROW &&
  value.width * value.height <= MAX_READ_CELLS, 'Read region must fit 80 columns, safe rows, and at most 2048 cells.')
export const DrawInputSchema = z.strictObject({
  documentId: z.uuid(),
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  cells: z.array(AgentCellSchema).min(1).max(MAX_AGENT_CELLS),
})
export const AgentCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('read'), input: ReadInputSchema }),
  z.strictObject({ type: z.literal('draw'), input: DrawInputSchema }),
])
export type AgentCommand = z.infer<typeof AgentCommandSchema>
export type AgentCell = z.infer<typeof AgentCellSchema>
export const AgentResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    documentId: z.uuid(),
    revision: z.number().int().nonnegative(),
    cells: z.array(AgentCellSchema).max(MAX_READ_CELLS).optional(),
  }),
  z.strictObject({ ok: z.literal(false), error: z.string().min(1).max(300) }),
])
export type AgentResult = z.infer<typeof AgentResultSchema>
export const JobSchema = z.strictObject({
  id: z.uuid(),
  agent: z.string().min(1).max(60),
  command: AgentCommandSchema,
})
export type AgentJob = z.infer<typeof JobSchema>
export const GrantSchema = z.strictObject({ id: z.uuid(), name: z.string(), expiresAt: z.number() })
export const OwnerResponseSchema = z.strictObject({
  documentId: z.uuid(),
  grants: z.array(GrantSchema).max(16),
  job: JobSchema.optional(),
  token: z.string().regex(/^[a-f0-9]{64}$/).optional(),
})
export type OwnerResponse = z.infer<typeof OwnerResponseSchema>
export const OwnerRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('attach'), clientId: z.uuid() }),
  z.strictObject({ action: z.literal('poll'), clientId: z.uuid() }),
  z.strictObject({ action: z.literal('detach'), clientId: z.uuid() }),
  z.strictObject({ action: z.literal('grant'), clientId: z.uuid(), name: z.string().trim().min(1).max(60) }),
  z.strictObject({ action: z.literal('revoke'), clientId: z.uuid(), id: z.uuid() }),
  z.strictObject({ action: z.literal('result'), clientId: z.uuid(), id: z.uuid(), result: AgentResultSchema }),
])
