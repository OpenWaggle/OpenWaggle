import { z } from 'zod'
import type { ConversationId } from './brand'

export const questionOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
})

export const userQuestionSchema = z.object({
  question: z.string(),
  options: z.array(questionOptionSchema),
})

/** Schema for parsing askUser tool-call arguments from JSON. */
export const askUserArgsSchema = z.object({
  questions: z.array(userQuestionSchema),
})

export type QuestionOption = z.infer<typeof questionOptionSchema>
export type UserQuestion = z.infer<typeof userQuestionSchema>

export interface QuestionPayload {
  conversationId: ConversationId
  questions: UserQuestion[]
}

export interface QuestionAnswer {
  question: string
  selectedOption: string
}

const questionAnswerSchema = z.object({
  question: z.string(),
  selectedOption: z.string(),
})

/**
 * Schema for parsing the `result.content` of an askUser tool result.
 * Handles both the `{ kind: 'json', data: { answers } }` envelope
 * and the direct `{ answers }` shape.
 */
export const askUserResultContentSchema = z.union([
  z.object({
    kind: z.literal('json'),
    data: z.object({ answers: z.array(questionAnswerSchema) }),
  }),
  z.object({ answers: z.array(questionAnswerSchema) }),
])
