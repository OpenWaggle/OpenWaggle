import type { McpGetSettingsInput, McpJsonValue } from './mcp'
import type { McpAppDescriptor } from './mcp-gateway'

export interface McpPromptDescriptor {
  readonly serverInstanceId: string
  readonly serverLabel: string
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly arguments: readonly {
    readonly name: string
    readonly description?: string
    readonly required: boolean
  }[]
}

export interface McpResourceDescriptor {
  readonly serverInstanceId: string
  readonly serverLabel: string
  readonly uri: string
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly mimeType?: string
  readonly size?: number
}

export interface McpResourceTemplateDescriptor {
  readonly serverInstanceId: string
  readonly serverLabel: string
  readonly uriTemplate: string
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly mimeType?: string
}

export interface McpServerInstructionsDescriptor {
  readonly serverInstanceId: string
  readonly serverLabel: string
  readonly instructions: string
  readonly truncated: boolean
}

export interface McpRemoteSkillResourceDescriptor {
  readonly uri: string
  readonly digest: string
}

export interface McpRemoteSkillDescriptor {
  readonly serverInstanceId: string
  readonly serverLabel: string
  readonly uri: string
  readonly name: string
  readonly description: string
  readonly frontmatter: McpJsonValue
  readonly resources: readonly McpRemoteSkillResourceDescriptor[]
  readonly integrity: 'content-bound' | 'dynamic-unverified'
  readonly directoryRead: boolean
  readonly experimental: true
}

export interface McpCapabilityCatalog {
  readonly instructions: readonly McpServerInstructionsDescriptor[]
  readonly prompts: readonly McpPromptDescriptor[]
  readonly resources: readonly McpResourceDescriptor[]
  readonly resourceTemplates: readonly McpResourceTemplateDescriptor[]
  readonly apps: readonly McpAppDescriptor[]
  readonly tasks: readonly McpTaskRecord[]
  readonly skills: readonly McpRemoteSkillDescriptor[]
}

export interface McpRemoteSkillReview {
  readonly skill: McpRemoteSkillDescriptor
  readonly markdown: string
  readonly digestVerified: boolean
  readonly warnings: readonly string[]
  readonly attribution: { readonly serverInstanceId: string; readonly serverLabel: string }
}

export interface McpPromptResult {
  readonly description?: string
  readonly messages: McpJsonValue
  readonly attribution: { readonly serverInstanceId: string; readonly serverLabel: string }
}

export interface McpResourceResult {
  readonly contents: McpJsonValue
  readonly attribution: { readonly serverInstanceId: string; readonly serverLabel: string }
}

export interface McpTaskRecord {
  readonly id: string
  readonly remoteTaskId: string
  readonly serverInstanceId: string
  readonly serverLabel: string
  readonly sessionId: string
  readonly projectPath: string
  readonly protocolVersion: string
  readonly configHash: string
  readonly schemaHash: string
  readonly status: string
  readonly progress?: number
  readonly updatedAt: number
  readonly disabled: boolean
  readonly provenance: {
    readonly sourcePath: string
    readonly serverInstanceId: string
    readonly serverLabel: string
  }
  readonly task: McpJsonValue
}

export interface McpAppToolCallInput extends McpGetSettingsInput {
  readonly serverInstanceId: string
  readonly toolName: string
  readonly arguments: Readonly<Record<string, McpJsonValue>>
}

export interface McpAppToolCallResult {
  readonly content: McpJsonValue
  readonly structuredContent?: McpJsonValue
  readonly isError: boolean
  readonly attribution: {
    readonly serverInstanceId: string
    readonly serverLabel: string
    readonly toolName: string
  }
}

export interface McpListCapabilitiesInput extends McpGetSettingsInput {
  readonly serverInstanceId?: string
}

export interface McpGetPromptInput extends McpGetSettingsInput {
  readonly serverInstanceId: string
  readonly name: string
  readonly arguments?: Readonly<Record<string, string>>
}

export interface McpReadResourceInput extends McpGetSettingsInput {
  readonly serverInstanceId: string
  readonly uri: string
}

export interface McpReviewRemoteSkillInput extends McpGetSettingsInput {
  readonly serverInstanceId: string
  readonly uri: string
}

export interface McpTaskOperationInput extends McpGetSettingsInput {
  readonly serverInstanceId: string
  readonly operation: 'list' | 'get' | 'cancel'
  readonly taskId?: string
}

export type McpEventKind =
  | 'tools-list-changed'
  | 'prompts-list-changed'
  | 'resources-list-changed'
  | 'resource-updated'
  | 'task-status'
  | 'server-log'

export interface McpEventRecord {
  readonly id: string
  readonly sessionId: string
  readonly serverInstanceId: string
  readonly serverLabel: string
  readonly kind: McpEventKind
  readonly receivedAt: number
  readonly payload: McpJsonValue
  readonly read: boolean
}

export interface McpSetEventSubscriptionInput extends McpGetSettingsInput {
  readonly serverInstanceId: string
  readonly enabled: boolean
  readonly resourceUris?: readonly string[]
}

export interface McpEventSubscriptionState {
  readonly serverInstanceId: string
  readonly serverLabel: string
  readonly active: boolean
  readonly mode: 'modern-listen' | 'legacy-notifications' | 'inactive'
  readonly resourceUris: readonly string[]
  readonly detail: string
}
