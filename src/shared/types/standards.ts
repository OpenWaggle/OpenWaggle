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

export interface SkillLoadSuccessResult {
  readonly ok: true
  readonly skillId: string
  readonly name: string
  readonly description: string
  readonly instructions: string
  readonly folderPath: string
  readonly skillPath: string
  readonly hasScripts: boolean
  readonly alreadyLoaded: boolean
  readonly warning?: string
}

export interface SkillLoadErrorResult {
  readonly ok: false
  readonly skillId: string
  readonly alreadyLoaded: boolean
  readonly error: string
  readonly warning?: string
}

export type SkillLoadToolResult = SkillLoadSuccessResult | SkillLoadErrorResult

export interface AgentsLoadSuccessResult {
  readonly ok: true
  readonly requestedPath: string
  readonly alreadyLoaded: boolean
  readonly resolution: AgentsResolutionResult
  readonly effectiveInstruction: string
  readonly warning?: string
}

export interface AgentsLoadErrorResult {
  readonly ok: false
  readonly requestedPath: string
  readonly alreadyLoaded: boolean
  readonly error: string
  readonly warning?: string
}

export type AgentsLoadToolResult = AgentsLoadSuccessResult | AgentsLoadErrorResult
