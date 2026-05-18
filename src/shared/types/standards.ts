export type AgentsInstructionStatus = 'found' | 'missing' | 'error'

interface AgentsScopeItemBase {
  readonly filePath: string
  readonly scopeDir: string
  readonly scopeRelativeDir: string
}

export type AgentsScopeItem =
  | (AgentsScopeItemBase & {
      readonly status: 'found'
      readonly content: string
      readonly error?: undefined
    })
  | (AgentsScopeItemBase & {
      readonly status: 'missing'
      readonly content: ''
      readonly error?: undefined
    })
  | (AgentsScopeItemBase & {
      readonly status: 'error'
      readonly content: ''
      readonly error: string
    })

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
