import { Schema } from '@shared/schema'
import type { ConversationId } from './brand'

export type PlanResponse =
  | { readonly action: 'approve' }
  | {
      readonly action: 'revise'
      readonly feedback: string
    }

export const planResponseSchema = Schema.Union(
  Schema.Struct({ action: Schema.Literal('approve') }),
  Schema.Struct({
    action: Schema.Literal('revise'),
    feedback: Schema.String.pipe(Schema.minLength(1)),
  }),
)

export interface PlanPayload {
  readonly conversationId: ConversationId
  readonly planText: string
}
