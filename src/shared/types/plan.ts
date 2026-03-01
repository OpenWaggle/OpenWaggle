import { z } from 'zod'
import type { ConversationId } from './brand'

export const planResponseSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('revise'), feedback: z.string().min(1) }),
])

export type PlanResponse = z.infer<typeof planResponseSchema>

export interface PlanProposal {
  readonly conversationId: ConversationId
  readonly planText: string
}

export interface PlanPayload {
  readonly conversationId: ConversationId
  readonly planText: string
}
