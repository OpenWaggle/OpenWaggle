import type {
  McpAppToolCallResult,
  McpCapabilityCatalog,
  McpCapabilityFamily,
  McpDirectToolDescriptor,
  McpDoctorResult,
  McpEventRecord,
  McpEventSubscriptionState,
  McpGatewayInput,
  McpGatewayResult,
  McpJsonValue,
  McpPromptResult,
  McpRemoteSkillReview,
  McpResourceResult,
  McpRuntimeNotice,
  McpTaskOperationInput,
  McpTaskRecord,
  McpTurnSnapshot,
} from '@shared/types/mcp'
import { Context, type Effect } from 'effect'
import type { McpRuntimeFailure } from './mcp-errors'

export interface McpElicitationResult {
  readonly action: 'accept' | 'decline' | 'cancel'
  readonly content?: Readonly<Record<string, string | number | boolean | string[]>>
}

export type McpSamplingContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: string }
  | { readonly type: 'audio'; readonly data: string; readonly mimeType: string }
  | {
      readonly type: 'tool_use'
      readonly id: string
      readonly name: string
      readonly input: Readonly<Record<string, unknown>>
    }

export interface McpSamplingResult {
  readonly model: string
  readonly role: 'assistant'
  readonly content: McpSamplingContent | McpSamplingContent[]
  readonly stopReason?: string
}

export interface McpRuntimeInteractions {
  readonly elicit: (input: {
    readonly serverInstanceId: string
    readonly serverLabel: string
    readonly request: McpJsonValue
    readonly signal?: AbortSignal
  }) => Promise<McpElicitationResult>
  readonly sample: (input: {
    readonly serverInstanceId: string
    readonly serverLabel: string
    readonly request: McpJsonValue
    readonly signal?: AbortSignal
  }) => Promise<McpSamplingResult>
}

export interface McpRuntimeConnectionStatus {
  readonly runtimeNamespace: string
  readonly sessionId: string
  readonly projectPath: string
  readonly snapshotRevision: string
  readonly serverInstanceId: string
  readonly connectionState: 'connecting' | 'connected'
  readonly negotiatedProtocolVersion?: string
  readonly capabilities: readonly McpCapabilityFamily[]
}

/** How the servers a turn waited for ended up once it stopped waiting. */
export interface McpDirectToolWaitOutcome {
  readonly connected: readonly string[]
  /** Optional servers whose grace ended first; they keep connecting for the next turn. */
  readonly stillConnecting: readonly string[]
  readonly unavailable: readonly string[]
}

export interface McpDirectToolListOptions {
  /** Called with the servers the turn is about to wait for, only when it waits for any. */
  readonly onWaiting?: (serverNames: readonly string[]) => void
  /** Called once that wait is over, only when there was one and the turn goes ahead. */
  readonly onWaitSettled?: (outcome: McpDirectToolWaitOutcome) => void
}

export interface McpRuntimeServiceShape {
  readonly prepareTurn: (input: {
    readonly sessionId: string
    readonly snapshot: McpTurnSnapshot | null
  }) => Effect.Effect<void>
  readonly completeTurn: (input: {
    readonly sessionId: string
    readonly nextSnapshot: McpTurnSnapshot | null
  }) => Effect.Effect<void>
  readonly executeGateway: (input: {
    readonly snapshot: McpTurnSnapshot
    readonly request: McpGatewayInput
    readonly signal?: AbortSignal
    readonly interactions?: McpRuntimeInteractions
  }) => Effect.Effect<McpGatewayResult, McpRuntimeFailure>
  /**
   * The direct tools a turn registers with Pi. Optional servers do not hold the turn back: a
   * cached tool list stands in while they connect, and with nothing cached they get a short grace.
   */
  /** Forgets a server's remembered tool lists, after its credentials changed or it was removed. */
  readonly forgetToolCatalog: (serverInstanceId: string) => Effect.Effect<void>
  readonly listDirectTools: (
    snapshot: McpTurnSnapshot,
    options?: McpDirectToolListOptions,
  ) => Effect.Effect<readonly McpDirectToolDescriptor[], McpRuntimeFailure>
  readonly browseCapabilities: (input: {
    readonly snapshot: McpTurnSnapshot
    readonly serverInstanceId?: string
  }) => Effect.Effect<McpCapabilityCatalog, McpRuntimeFailure>
  readonly getPrompt: (input: {
    readonly snapshot: McpTurnSnapshot
    readonly serverInstanceId: string
    readonly name: string
    readonly arguments?: Readonly<Record<string, string>>
  }) => Effect.Effect<McpPromptResult, McpRuntimeFailure>
  readonly readResource: (input: {
    readonly snapshot: McpTurnSnapshot
    readonly serverInstanceId: string
    readonly uri: string
  }) => Effect.Effect<McpResourceResult, McpRuntimeFailure>
  readonly reviewRemoteSkill: (input: {
    readonly snapshot: McpTurnSnapshot
    readonly serverInstanceId: string
    readonly uri: string
  }) => Effect.Effect<McpRemoteSkillReview, McpRuntimeFailure>
  readonly callAppTool: (input: {
    readonly snapshot: McpTurnSnapshot
    readonly serverInstanceId: string
    readonly toolName: string
    readonly arguments: Readonly<Record<string, McpJsonValue>>
    readonly signal?: AbortSignal
  }) => Effect.Effect<McpAppToolCallResult, McpRuntimeFailure>
  readonly operateTask: (input: {
    readonly snapshot: McpTurnSnapshot | null
    readonly request: McpTaskOperationInput
  }) => Effect.Effect<readonly McpTaskRecord[], McpRuntimeFailure>
  readonly setEventSubscription: (input: {
    readonly snapshot: McpTurnSnapshot
    readonly serverInstanceId: string
    readonly enabled: boolean
    readonly resourceUris: readonly string[]
  }) => Effect.Effect<McpEventSubscriptionState, McpRuntimeFailure>
  readonly getEvents: (sessionId?: string | null) => Effect.Effect<readonly McpEventRecord[]>
  readonly getEventSubscriptions: (
    sessionId?: string | null,
  ) => Effect.Effect<readonly McpEventSubscriptionState[]>
  readonly disposeSession: (sessionId: string) => Effect.Effect<void>
  readonly reconcileIdleConnections: () => Effect.Effect<void>
  readonly disposeAll: () => Effect.Effect<void>
  readonly getConnectionStatuses: () => Effect.Effect<readonly McpRuntimeConnectionStatus[]>
  readonly getNotices: (sessionId?: string | null) => Effect.Effect<readonly McpRuntimeNotice[]>
  readonly doctor: (input?: {
    readonly projectPath?: string | null
    readonly sessionId?: string | null
  }) => Effect.Effect<McpDoctorResult>
}

export class McpRuntimeService extends Context.Tag('@openwaggle/McpRuntimeService')<
  McpRuntimeService,
  McpRuntimeServiceShape
>() {}
