import type {
  AgentDefinitionCatalogItem,
  AgentDefinitionDocument,
  AgentDefinitionImportSource,
  AgentDefinitionScope,
} from './agent-definition'

export type AgentDefinitionWritableScope = AgentDefinitionScope

export type AgentDefinitionImportFieldDisposition =
  | 'mapped'
  | 'defaulted'
  | 'dropped'
  | 'incompatible'
  | 'user-choice'

export interface AgentDefinitionImportFieldPlan {
  readonly sourceField: string
  readonly targetField?: string
  readonly disposition: AgentDefinitionImportFieldDisposition
  readonly detail: string
  readonly sourceValue?: unknown
  readonly mappedValue?: unknown
}

export interface AgentDefinitionImportPlan {
  readonly schemaVersion: 1
  readonly sourceTool: AgentDefinitionImportSource
  readonly sourcePath: string
  readonly sourceDigest: string
  readonly sourceName?: string
  readonly targetScope: AgentDefinitionWritableScope
  readonly destinationPath: string
  readonly status: 'ready' | 'blocked' | 'conflict'
  readonly fields: readonly AgentDefinitionImportFieldPlan[]
  readonly diagnostics: readonly string[]
  readonly document?: AgentDefinitionDocument
  readonly existingContentDigest?: string
}

export type AgentDefinitionManagementCommand =
  | { readonly operation: 'list'; readonly projectPath: string }
  | {
      readonly operation: 'write'
      readonly projectPath: string
      readonly scope: AgentDefinitionWritableScope
      readonly document: AgentDefinitionDocument
      readonly replaceExisting?: boolean
      readonly expectedContentDigest?: string
    }
  | {
      readonly operation: 'duplicate'
      readonly projectPath: string
      readonly sourceName: string
      readonly targetName: string
      readonly targetScope: AgentDefinitionWritableScope
    }
  | {
      readonly operation: 'delete'
      readonly projectPath: string
      readonly name: string
      readonly scope: AgentDefinitionWritableScope
      readonly expectedContentDigest?: string
    }
  | {
      readonly operation: 'import-plan'
      readonly projectPath: string
      readonly sourcePath: string
      readonly sourceTool?: AgentDefinitionImportSource | 'auto'
      readonly sourceName?: string
      readonly targetScope: AgentDefinitionWritableScope
    }
  | {
      readonly operation: 'import-apply'
      readonly projectPath: string
      readonly sourcePath: string
      readonly sourceTool?: AgentDefinitionImportSource | 'auto'
      readonly sourceName?: string
      readonly targetScope: AgentDefinitionWritableScope
      readonly expectedSourceDigest: string
      readonly replaceExisting?: boolean
      readonly expectedContentDigest?: string
    }
  | {
      readonly operation: 'refresh-plan'
      readonly projectPath: string
      readonly name: string
    }
  | {
      readonly operation: 'refresh-apply'
      readonly projectPath: string
      readonly name: string
      readonly expectedSourceDigest: string
      readonly replaceModified?: boolean
    }

export type AgentDefinitionManagementOutcome =
  | {
      readonly operation: 'list'
      readonly items: readonly AgentDefinitionCatalogItem[]
    }
  | {
      readonly operation: 'write' | 'duplicate' | 'delete' | 'import-apply' | 'refresh-apply'
      readonly name: string
      readonly scope: AgentDefinitionWritableScope
      readonly destinationPath: string
      readonly contentDigest?: string
    }
  | {
      readonly operation: 'import-plan' | 'refresh-plan'
      readonly plan: AgentDefinitionImportPlan
    }
