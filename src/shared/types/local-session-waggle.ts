import type { AgentSendReport, PreparedAttachment } from './agent'
import type { ThinkingLevel } from './settings'
import type {
  WaggleAgentColor,
  WaggleCollaborationMode,
  WaggleInvocationSource,
  WaggleStopCondition,
} from './waggle'

export const SESSION_WAGGLE_CONTRACT_VERSION = 1 as const

export interface LocalSessionWaggleConfig {
  readonly mode: WaggleCollaborationMode
  readonly agents: readonly [
    {
      readonly label: string
      readonly model: string
      readonly roleDescription: string
      readonly color: WaggleAgentColor
    },
    {
      readonly label: string
      readonly model: string
      readonly roleDescription: string
      readonly color: WaggleAgentColor
    },
  ]
  readonly stop: { readonly primary: WaggleStopCondition; readonly maxTurnsSafety: number }
}

export interface LocalSessionWagglePayload {
  readonly text: string
  readonly thinkingLevel: ThinkingLevel
  readonly attachments: PreparedAttachment[]
  readonly waggle?: {
    readonly presetId: string
    readonly presetName: string
    readonly source: WaggleInvocationSource
    readonly config: LocalSessionWaggleConfig
  }
}

export type LocalSessionWaggleCommandPayload =
  | {
      readonly contract: 'session-waggle-v1'
      readonly request: {
        readonly contractVersion: typeof SESSION_WAGGLE_CONTRACT_VERSION
        readonly requestId: string
        readonly idempotencyKey: string
        readonly sessionId: string
        readonly payload: LocalSessionWagglePayload
        readonly model: string
        readonly config: LocalSessionWaggleConfig
      }
    }
  | {
      readonly contract: 'session-waggle-cancel-v1'
      readonly request: {
        readonly contractVersion: typeof SESSION_WAGGLE_CONTRACT_VERSION
        readonly requestId: string
        readonly sessionId: string
      }
    }

export type LocalSessionWaggleCommandResult =
  | {
      readonly contract: 'session-waggle-v1'
      readonly response: {
        readonly contractVersion: typeof SESSION_WAGGLE_CONTRACT_VERSION
        readonly requestId: string
        readonly idempotencyKey: string
        readonly replayed: boolean
        readonly report: AgentSendReport
      }
    }
  | {
      readonly contract: 'session-waggle-cancel-v1'
      readonly response: {
        readonly contractVersion: typeof SESSION_WAGGLE_CONTRACT_VERSION
        readonly requestId: string
        readonly sessionId: string
        readonly cancelled: boolean
      }
    }
