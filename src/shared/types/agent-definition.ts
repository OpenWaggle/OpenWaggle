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
  readonly sourceName?: string
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

export interface AgentDefinitionDisplayItem extends Omit<AgentDefinitionCatalogItem, 'definition'> {
  readonly enabled: boolean
}

export interface ResolvedAgentDefinitionSnapshot extends AgentDefinitionDocument {
  readonly scope: AgentDefinitionScope
  readonly sourcePath: string
  readonly contentDigest: string
}

/**
 * The Agent definition a Session summary's lineage names, with its execution profile's model and
 * thinking level now, which the model picker and a Run's thinking level change after creation.
 * The thinking level is the one set for the Session; a model without that level runs lower.
 */
export interface AgentDefinitionLineageFacts {
  readonly agentDefinitionName?: string
  /** The model a Session created from an Agent definition runs with. */
  readonly agentModelId?: string
  /** The thinking level set for a Session created from an Agent definition. */
  readonly agentThinkingLevel?: ThinkingLevel
}
