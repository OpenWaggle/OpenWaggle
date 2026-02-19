import type { ConversationId } from './brand'

export interface QuestionOption {
  label: string
  description?: string
}

export interface UserQuestion {
  question: string
  options: QuestionOption[]
}

export interface QuestionPayload {
  conversationId: ConversationId
  questions: UserQuestion[]
}

export interface QuestionAnswer {
  question: string
  selectedOption: string
}
