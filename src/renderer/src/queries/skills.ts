import type { AgentsInstructionStatus, SkillCatalogResult } from '@shared/types/standards'
import { queryOptions } from '@tanstack/react-query'
import { api } from '@/shared/lib/ipc'
import { queryKeys } from './query-keys'
import type { OpenWaggleQueryOptions } from './query-options'

export interface StandardsStatus {
  readonly agents: AgentsInstructionStatus
  readonly agentsPath: string
  readonly error?: string
}

export interface SkillResourcesResult {
  readonly standardsStatus: StandardsStatus
  readonly catalog: SkillCatalogResult
}

export async function fetchSkillResources(projectPath: string) {
  const [standardsStatus, catalog] = await Promise.all([
    api.getStandardsStatus(projectPath),
    api.listSkills(projectPath),
  ])

  return { standardsStatus, catalog }
}

export async function fetchSkillPreview(projectPath: string, skillId: string) {
  return api.getSkillPreview(projectPath, skillId)
}

type SkillPreviewResult = Awaited<ReturnType<typeof fetchSkillPreview>>

export function skillResourcesQueryOptions(
  projectPath: string | null,
): OpenWaggleQueryOptions<
  SkillResourcesResult,
  Error,
  SkillResourcesResult,
  ReturnType<typeof queryKeys.skills>
> {
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

export function skillPreviewQueryOptions(
  projectPath: string | null,
  skillId: string | null,
  enabled: boolean = projectPath !== null && skillId !== null,
): OpenWaggleQueryOptions<
  SkillPreviewResult,
  Error,
  SkillPreviewResult,
  ReturnType<typeof queryKeys.skillPreview>
> {
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
