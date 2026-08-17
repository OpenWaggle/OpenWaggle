import type {
  McpGetSettingsInput,
  McpImportSource,
  McpServerDefinition,
  McpSettingsView,
} from './mcp'

export interface McpImportCandidate {
  readonly source: McpImportSource
  readonly sourcePath: string
  readonly suggestedTarget: 'global' | 'project'
  readonly name: string
  readonly definition: McpServerDefinition
  readonly fingerprint: string
  readonly warnings: readonly string[]
}

export interface McpImportPreview {
  readonly candidates: readonly McpImportCandidate[]
  readonly unavailableSources: readonly McpImportSource[]
}

export interface McpImportPreviewInput {
  readonly projectPath?: string | null
  readonly sources?: readonly McpImportSource[]
}

export interface McpImportApplyInput extends McpImportPreviewInput {
  readonly fingerprints: readonly string[]
  readonly target: 'global' | 'project'
  readonly conflictPolicy: 'skip' | 'replace' | 'rename'
}

export interface McpImportApplyResult {
  readonly imported: readonly {
    readonly source: McpImportSource
    readonly sourceName: string
    readonly targetName: string
    readonly fingerprint: string
  }[]
  readonly skipped: readonly { readonly fingerprint: string; readonly reason: string }[]
  readonly view: McpSettingsView
}

export interface McpAddServerInput extends McpGetSettingsInput {
  readonly name: string
  readonly definition: McpServerDefinition
  readonly target: 'global' | 'project'
  readonly replace?: boolean
}

export interface McpTaskSummary {
  readonly id: string
  readonly serverInstanceId: string
  readonly remoteTaskId: string
  readonly status: 'working' | 'input-required' | 'completed' | 'failed' | 'cancelled' | 'unknown'
  readonly progress?: number
  readonly updatedAt: number
  readonly disabled: boolean
  readonly notice?: string
}

export interface McpDoctorResult {
  readonly ok: boolean
  readonly checks: readonly {
    readonly id: string
    readonly status: 'pass' | 'warning' | 'fail'
    readonly message: string
    readonly action?: string
  }[]
}

export type McpDoctorInput = McpGetSettingsInput

export interface McpSecretSummary {
  readonly name: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface McpSetSecretInput {
  readonly name: string
  readonly value: string
}

export interface McpRemoveSecretInput {
  readonly name: string
}
