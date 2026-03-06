import type { AgentsInstructionStatus, SkillCatalogResult } from '@shared/types/standards'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/ipc'
import { queryKeys } from './query-keys'

export interface StandardsStatus {
  readonly agents: AgentsInstructionStatus
  readonly agentsPath: string
  readonly error?: string
}

export interface SkillResourcesResult {
  readonly standardsStatus: StandardsStatus
  readonly catalog: SkillCatalogResult
}

export async function fetchSkillResources(projectPath: string): Promise<SkillResourcesResult> {
  const [standardsStatus, catalog] = await Promise.all([
    api.getStandardsStatus(projectPath),
    api.listSkills(projectPath),
  ])

  return { standardsStatus, catalog }
}

export function skillResourcesQueryOptions(projectPath: string | null) {
  return queryOptions({
    queryKey: queryKeys.skills(projectPath),
    enabled: projectPath !== null,
    queryFn: () => {
      if (!projectPath) {
        throw new Error('Project path is required to load skills.')
      }

      return fetchSkillResources(projectPath)
    },
  })
}

export async function fetchSkillPreview(projectPath: string, skillId: string) {
  return api.getSkillPreview(projectPath, skillId)
}

export function skillPreviewQueryOptions(
  projectPath: string | null,
  skillId: string | null,
  enabled: boolean = projectPath !== null && skillId !== null,
) {
  return queryOptions({
    queryKey: queryKeys.skillPreview(projectPath, skillId),
    enabled,
    queryFn: () => {
      if (!projectPath || !skillId) {
        throw new Error('A selected skill is required to load the preview.')
      }

      return fetchSkillPreview(projectPath, skillId)
    },
  })
}
