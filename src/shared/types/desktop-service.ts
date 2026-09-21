import type { DesktopBrowserCommand, DesktopBrowserResult } from './desktop-browser-service'
import type { DesktopTerminalCommand, DesktopTerminalResult } from './desktop-terminal-service'

export const DESKTOP_SERVICE_LIMITS = {
  pendingCommands: 64,
  batchCommands: 16,
  payloadBytes: 4 * 1024 * 1024,
  resultBytes: 63 * 1024 * 1024,
  errorLength: 2048,
  commandTimeoutMs: 90_000,
  pollTimeoutMs: 5_000,
  leaseTimeoutMs: 15_000,
  fenceRecords: 256,
} as const

export type DesktopMutationScope =
  | { readonly kind: 'owner'; readonly ownerKey: string }
  | { readonly kind: 'path'; readonly directoryPath: string }

/** Durable journal: released records remain until their exact GUI fence is acknowledged. */
export interface DesktopFenceRecord {
  readonly token: string
  readonly hostInstanceId: string
  readonly scope: DesktopMutationScope
  readonly state: 'active' | 'released'
}

export type DesktopServiceCommand =
  | DesktopBrowserCommand
  | DesktopTerminalCommand
  | {
      readonly service: 'fence'
      readonly operation: 'acquire'
      readonly record: DesktopFenceRecord
    }
  | { readonly service: 'browser'; readonly operation: 'deleteOwner'; readonly ownerKey: string }

export type DesktopServiceResult =
  | DesktopBrowserResult
  | DesktopTerminalResult
  | { readonly service: 'fence'; readonly operation: 'acquire'; readonly value: null }
  | { readonly service: 'browser'; readonly operation: 'deleteOwner'; readonly value: null }

export interface DesktopCommandEnvelope {
  readonly commandId: string
  readonly leaseId: string
  readonly deadline: number
  readonly command: DesktopServiceCommand
}

export type DesktopCompletion =
  | {
      readonly commandId: string
      readonly outcome: 'success'
      readonly result: DesktopServiceResult
    }
  | {
      readonly commandId: string
      readonly outcome: 'failure'
      readonly message: string
      readonly uncertain?: boolean
    }

export type DesktopServiceRequest =
  | {
      readonly operation: 'markClosed'
      readonly guiInstanceId: string
      readonly hostInstanceId: string
    }
  | { readonly operation: 'register'; readonly guiInstanceId: string }
  | {
      readonly operation: 'ready'
      readonly leaseId: string
      readonly fenceTokens: readonly string[]
    }
  | { readonly operation: 'poll'; readonly leaseId: string }
  | {
      readonly operation: 'heartbeat' | 'prepareDisconnect' | 'resumeDesktop'
      readonly leaseId: string
    }
  | {
      readonly operation: 'complete'
      readonly leaseId: string
      readonly completion: DesktopCompletion
    }
  | {
      readonly operation: 'acknowledgeReleased'
      readonly leaseId: string
      readonly token: string
      readonly hostInstanceId: string
    }
  | { readonly operation: 'disconnect'; readonly leaseId: string }

export type DesktopServiceResponse =
  | { readonly operation: 'quarantined'; readonly reason: 'previous-owner-unclean' }
  | {
      readonly operation: 'register'
      readonly leaseId: string
      readonly hostInstanceId: string
      readonly fences: readonly DesktopFenceRecord[]
    }
  | {
      readonly operation: 'poll'
      readonly commands: readonly DesktopCommandEnvelope[]
      readonly cancelledCommandIds: readonly string[]
      readonly fences: readonly DesktopFenceRecord[]
    }
  | {
      readonly operation: 'prepareDisconnect'
      readonly accepted: true
      readonly fences: readonly DesktopFenceRecord[]
    }
  | {
      readonly operation:
        | 'ready'
        | 'complete'
        | 'acknowledgeReleased'
        | 'disconnect'
        | 'markClosed'
        | 'heartbeat'
        | 'resumeDesktop'
      readonly accepted: boolean
    }
