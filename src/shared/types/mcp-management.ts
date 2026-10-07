import type { McpImportSource, McpServerDefinition } from './mcp'

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
