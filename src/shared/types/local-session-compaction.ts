import type { ContextCompactionResult } from './context-usage'

export type LocalSessionCompactionCommandPayload =
  | {
      readonly contract: 'local-compaction-v1'
      readonly request: {
        readonly requestId: string
        readonly sessionId: string
        readonly model: string
        readonly customInstructions?: string
      }
    }
  | {
      readonly contract: 'local-compaction-cancel-v1'
      readonly request: {
        readonly requestId: string
        readonly sessionId: string
      }
    }

export type LocalSessionCompactionCommandResult =
  | {
      readonly contract: 'local-compaction-v1'
      readonly response: {
        readonly requestId: string
        readonly sessionId: string
        readonly result: ContextCompactionResult
      }
    }
  | {
      readonly contract: 'local-compaction-cancel-v1'
      readonly response: {
        readonly requestId: string
        readonly sessionId: string
        readonly cancelled: boolean
      }
    }
