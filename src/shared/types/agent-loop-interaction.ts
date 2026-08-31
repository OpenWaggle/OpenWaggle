import type {
  AgentAuthorizationDecisionScope,
  AgentAuthorizationScopeKey,
} from './agent-authorization-grants'
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

/**
 * Why a confirmation is being asked.
 *
 * Declared where the request is raised, never inferred from the wording, so a copy edit cannot
 * silently change what an access mode is allowed to answer.
 *
 * - `authorization`: the agent asks to act itself inside this workspace and session. The only
 *   purpose full access may answer.
 * - `user-input`: a question addressed to the user. Nothing may answer it for them.
 * - `disclosure`: exists to tell the user who is asking and for what, before they supply it.
 * - `external-navigation`: continues outside the application, at a destination the agent or a
 *   third party chose.
 */
export type AgentLoopConfirmPurpose =
  | 'authorization'
  | 'user-input'
  | 'disclosure'
  | 'external-navigation'

export interface AgentLoopConfirmInteraction extends AgentLoopInteractionBase {
  readonly kind: 'confirm'
  readonly title: string
  readonly message: string
  readonly purpose: AgentLoopConfirmPurpose
  /** Present only for `authorization`, naming what a kept approval would cover. */
  readonly scopeKey?: AgentAuthorizationScopeKey
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
  readonly customType: string
  readonly payload?: JsonValue
  readonly renderer: {
    readonly kind: 'pi-tui-custom'
    readonly supported: false
    readonly overlay?: boolean
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
  /** How far an acceptance reaches. Absent means this once only. */
  readonly scope?: AgentAuthorizationDecisionScope
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
  | 'interaction-timeout'

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
