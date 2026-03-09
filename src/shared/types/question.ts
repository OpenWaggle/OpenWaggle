import { Schema } from '@shared/schema'
import type { ConversationId } from './brand'

export interface QuestionOption {
  readonly label: string
  readonly description?: string
}

export interface UserQuestion {
  readonly question: string
  readonly options: readonly QuestionOption[]
}

export interface QuestionAnswer {
  readonly question: string
  readonly selectedOption: string
}

export const questionOptionSchema = Schema.Struct({
  label: Schema.String,
  description: Schema.optional(Schema.String),
})

export const userQuestionSchema = Schema.Struct({
  question: Schema.String,
  options: Schema.Array(questionOptionSchema),
})

/** Schema for parsing askUser tool-call arguments from JSON. */
export const askUserArgsSchema = Schema.Struct({
  questions: Schema.Array(userQuestionSchema),
})

export interface QuestionPayload {
  conversationId: ConversationId
  questions: readonly UserQuestion[]
}

const questionAnswerSchema = Schema.Struct({
  question: Schema.String,
  selectedOption: Schema.String,
})

/**
 * Schema for parsing the `result.content` of an askUser tool result.
 * Handles both the `{ kind: 'json', data: { answers } }` envelope
 * and the direct `{ answers }` shape.
 */
export const askUserResultContentSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('json'),
    data: Schema.Struct({ answers: Schema.Array(questionAnswerSchema) }),
  }),
  Schema.Struct({ answers: Schema.Array(questionAnswerSchema) }),
)
