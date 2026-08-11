import type {
  McpCapabilityFamily,
  McpEventKind,
  McpJsonValue,
  McpTurnSnapshot,
  McpTurnSnapshotServer,
} from '@shared/types/mcp'
import type { McpRuntimeInteractions } from '../../../ports/mcp-runtime-service'

export interface McpRuntimeTool {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly inputSchema?: McpJsonValue
  readonly outputSchema?: McpJsonValue
  readonly annotations?: McpJsonValue
  readonly meta?: McpJsonValue
}

export interface McpRuntimeToolResult {
  readonly content: McpJsonValue
  readonly structuredContent?: McpJsonValue
  readonly isError: boolean
}

export interface McpClientConnection {
  readonly negotiatedProtocolVersion: string
  readonly capabilities: readonly McpCapabilityFamily[]
  readonly serverClaim?: { readonly name: string; readonly version: string }
  readonly instructions?: string
  readonly instructionsTruncated?: boolean
  readonly skillExtension?: { readonly directoryRead: boolean }
  listTools(signal?: AbortSignal): Promise<readonly McpRuntimeTool[]>
  callTool(input: {
    readonly name: string
    readonly arguments: Readonly<Record<string, unknown>>
    readonly signal?: AbortSignal
    readonly interactions?: McpRuntimeInteractions
  }): Promise<McpRuntimeToolResult>
  listPrompts(signal?: AbortSignal): Promise<McpJsonValue>
  getPrompt(input: {
    readonly name: string
    readonly arguments?: Readonly<Record<string, string>>
    readonly signal?: AbortSignal
  }): Promise<McpJsonValue>
  listResources(signal?: AbortSignal): Promise<McpJsonValue>
  listResourceTemplates(signal?: AbortSignal): Promise<McpJsonValue>
  readResource(input: {
    readonly uri: string
    readonly signal?: AbortSignal
  }): Promise<McpJsonValue>
  listSkills(signal?: AbortSignal): Promise<McpJsonValue>
  getSkill(input: { readonly uri: string; readonly signal?: AbortSignal }): Promise<McpJsonValue>
  listTasks(signal?: AbortSignal): Promise<McpJsonValue>
  getTask(input: { readonly taskId: string; readonly signal?: AbortSignal }): Promise<McpJsonValue>
  cancelTask(input: {
    readonly taskId: string
    readonly signal?: AbortSignal
  }): Promise<McpJsonValue>
  subscribeEvents(input: {
    readonly resourceUris: readonly string[]
    readonly onEvent: (event: {
      readonly kind: McpEventKind
      readonly payload: McpJsonValue
    }) => void
    readonly signal?: AbortSignal
  }): Promise<{
    readonly mode: 'modern-listen' | 'legacy-notifications'
    readonly resourceUris: readonly string[]
    close(): Promise<void>
  }>
  close(): Promise<void>
}

export interface McpConnectionFactoryInput {
  readonly snapshot: McpTurnSnapshot
  readonly server: McpTurnSnapshotServer
}

export type McpConnectionFactory = (
  input: McpConnectionFactoryInput,
) => Promise<McpClientConnection>

export type McpSecretResolver = (name: string) => Promise<string>
