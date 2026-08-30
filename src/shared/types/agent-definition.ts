import type { AgentAuthorizationMode } from './agent-authorization'
import type { SessionCapability } from './session-capability'
import type { ThinkingLevel } from './settings'

export type AgentDefinitionScope = 'project' | 'portable-project' | 'user'
export type AgentDefinitionImportSource =
  | 'openwaggle'
  | 'codex'
  | 'claude-code'
  | 'cursor'
  | 'gemini-cli'
  | 'github-copilot'
  | 'opencode'

export interface AgentDefinitionImportProvenance {
  readonly sourceTool: AgentDefinitionImportSource
  readonly sourcePath: string
  readonly sourceDigest: string
  readonly importerVersion: 1
  readonly baselineDigest: string
  readonly importedAt: number
}

export interface AgentDefinitionDocument {
  readonly schemaVersion: 1
  readonly $schema?: string
  readonly name: string
  readonly description: string
  readonly model?: string
  readonly reasoning?: ThinkingLevel
  readonly tools?: readonly string[]
  readonly skills?: readonly string[]
  readonly mcpServers?: readonly string[]
  readonly sessionCapabilities?: readonly SessionCapability[]
  readonly authorizationMode?: AgentAuthorizationMode
  readonly workspace?: 'share-parent' | 'local' | 'new-worktree'
  readonly import?: AgentDefinitionImportProvenance
  readonly instructions: string
}

export interface AgentDefinitionCatalogItem {
  readonly name: string
  readonly description: string
  readonly scope: AgentDefinitionScope
  readonly sourcePath: string
  readonly contentDigest?: string
  readonly definition?: AgentDefinitionDocument
  readonly loadError?: string
}

export interface ResolvedAgentDefinitionSnapshot extends AgentDefinitionDocument {
  readonly scope: AgentDefinitionScope
  readonly sourcePath: string
  readonly contentDigest: string
}
