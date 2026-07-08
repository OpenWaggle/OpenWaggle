import type { JsonValue } from './json.js'

export interface OpenWaggleToolCallSurfaceInput {
  readonly surface: 'tool'
  readonly toolCall: {
    readonly id: string
    readonly name: string
    readonly input?: JsonValue
  }
  readonly toolResult?: {
    readonly ok: boolean
    readonly output?: JsonValue
    readonly error?: string
  }
}

export interface OpenWaggleCustomMessageSurfaceInput {
  readonly surface: 'custom-message'
  readonly message: {
    readonly name: string
    readonly payload?: JsonValue
  }
}

export interface OpenWaggleInteractionSurfaceInput {
  readonly surface: 'interaction'
  readonly interaction: {
    readonly id: string
    readonly customType: string
    readonly payload?: JsonValue
  }
}

export interface OpenWaggleTranscriptSurfaceInput {
  readonly surface: 'transcript'
  readonly transcript: {
    readonly sessionId?: string
    readonly messageCount: number
    readonly payload?: JsonValue
  }
}

export interface OpenWaggleStatusSurfaceInput {
  readonly surface: 'status'
  readonly status: {
    readonly label: string
    readonly payload?: JsonValue
  }
}

export type OpenWaggleAgentLoopSurfaceInput =
  | OpenWaggleToolCallSurfaceInput
  | OpenWaggleCustomMessageSurfaceInput
  | OpenWaggleInteractionSurfaceInput
  | OpenWaggleTranscriptSurfaceInput
  | OpenWaggleStatusSurfaceInput
