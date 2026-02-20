export type AgentsInstructionStatus = 'found' | 'missing' | 'error'

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
