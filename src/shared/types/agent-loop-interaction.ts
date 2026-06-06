import type { SessionId } from './brand'
import type { JsonValue } from './json'

export type AgentLoopInteractionKind =
  | 'confirm'
  | 'select'
  | 'input'
  | 'editor'
  | 'notify'
  | 'custom'
export type AgentLoopInteractionStatus = 'pending' | 'resolved' | 'cancelled' | 'errored'
export type AgentLoopInteractionSource = 'pi-ui'
export type AgentLoopNotifyLevel = 'info' | 'warning' | 'error'

export interface AgentLoopInteractionBase {
  readonly interactionId: string
  readonly sessionId: SessionId
  readonly runId: string
  readonly kind: AgentLoopInteractionKind
  readonly source: AgentLoopInteractionSource
  readonly createdAt: number
  readonly timeoutMs?: number
}

export interface AgentLoopConfirmInteraction extends AgentLoopInteractionBase {
  readonly kind: 'confirm'
  readonly title: string
  readonly message: string
}

export interface AgentLoopSelectInteraction extends AgentLoopInteractionBase {
  readonly kind: 'select'
  readonly title: string
  readonly choices: readonly string[]
}

export interface AgentLoopInputInteraction extends AgentLoopInteractionBase {
  readonly kind: 'input'
  readonly title: string
  readonly placeholder?: string
}

export interface AgentLoopEditorInteraction extends AgentLoopInteractionBase {
  readonly kind: 'editor'
  readonly title: string
  readonly prefill?: string
}

export interface AgentLoopNotifyInteraction extends AgentLoopInteractionBase {
  readonly kind: 'notify'
  readonly message: string
  readonly level: AgentLoopNotifyLevel
}

export interface AgentLoopCustomInteraction extends AgentLoopInteractionBase {
  readonly kind: 'custom'
  readonly renderer: {
    readonly kind: 'pi-tui-custom'
    readonly supported: false
  }
}

export type AgentLoopInteraction =
  | AgentLoopConfirmInteraction
  | AgentLoopSelectInteraction
  | AgentLoopInputInteraction
  | AgentLoopEditorInteraction
  | AgentLoopNotifyInteraction
  | AgentLoopCustomInteraction

export interface AgentLoopConfirmResponse {
  readonly kind: 'confirm'
  readonly accepted: boolean
}

export interface AgentLoopSelectResponse {
  readonly kind: 'select'
  readonly selected: string | null
}

export interface AgentLoopInputResponse {
  readonly kind: 'input'
  readonly value: string | null
}

export interface AgentLoopEditorResponse {
  readonly kind: 'editor'
  readonly value: string | null
}

export interface AgentLoopNotifyResponse {
  readonly kind: 'notify'
  readonly acknowledged: true
}

export interface AgentLoopCustomResponse {
  readonly kind: 'custom'
  readonly value: JsonValue | null
}

export type AgentLoopInteractionResponse =
  | AgentLoopConfirmResponse
  | AgentLoopSelectResponse
  | AgentLoopInputResponse
  | AgentLoopEditorResponse
  | AgentLoopNotifyResponse
  | AgentLoopCustomResponse

export interface AgentLoopInteractionResponseInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly interactionId: string
  readonly kind: AgentLoopInteractionKind
  readonly response: AgentLoopInteractionResponse
}

export type AgentLoopInteractionErrorCode =
  | 'interaction-not-found'
  | 'interaction-mismatch'
  | 'invalid-response-payload'
  | 'custom-renderer-unavailable'

export type AgentLoopInteractionSubmitResult =
  | {
      readonly ok: true
      readonly interactionId: string
      readonly status: AgentLoopInteractionStatus
    }
  | {
      readonly ok: false
      readonly error: {
        readonly code: AgentLoopInteractionErrorCode
        readonly message: string
      }
    }
