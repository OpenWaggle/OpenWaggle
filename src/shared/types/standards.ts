export type AgentsInstructionStatus = 'found' | 'missing' | 'error'

export interface AgentsScopeItem {
  readonly filePath: string
  readonly scopeDir: string
  readonly scopeRelativeDir: string
  readonly content: string
  readonly status: AgentsInstructionStatus
  readonly error?: string
}

export interface AgentsResolutionResult {
  readonly projectPath: string
  readonly root: AgentsScopeItem
  readonly scoped: readonly AgentsScopeItem[]
  readonly warnings: readonly string[]
}

export interface SkillDiscoveryItem {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly folderPath: string
  readonly skillPath: string
  readonly hasScripts: boolean
  readonly enabled: boolean
  readonly loadStatus: 'ok' | 'error'
  readonly loadError?: string
}

export interface SkillCatalogResult {
  readonly projectPath: string
  readonly skills: readonly SkillDiscoveryItem[]
}

export interface SkillActivationResult {
  readonly explicitSkillIds: readonly string[]
  readonly heuristicSkillIds: readonly string[]
  readonly selectedSkillIds: readonly string[]
}
