import type { SkillCatalogResult } from '@shared/types/standards'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '@/lib/ipc'
import { queryKeys } from '@/queries/query-keys'
import {
  type SkillResourcesResult,
  type StandardsStatus,
  skillPreviewQueryOptions,
  skillResourcesQueryOptions,
} from '@/queries/skills'

interface UseSkillsResult {
  standardsStatus: StandardsStatus | null
  catalog: SkillCatalogResult | null
  selectedSkillId: string | null
  previewMarkdown: string
  isLoading: boolean
  isPreviewLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  selectSkill: (skillId: string) => void
  toggleSkill: (skillId: string, enabled: boolean) => Promise<void>
}

function describeSkillsError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

export function useSkills(projectPath: string | null): UseSkillsResult {
  const queryClient = useQueryClient()
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const skillResourcesQuery = useQuery(skillResourcesQueryOptions(projectPath))

  const toggleSkillMutation = useMutation({
    mutationFn: ({
      nextProjectPath,
      skillId,
      enabled,
    }: {
      readonly nextProjectPath: string
      readonly skillId: string
      readonly enabled: boolean
    }) => api.setSkillEnabled(nextProjectPath, skillId, enabled),
  })

  const catalog = skillResourcesQuery.data?.catalog ?? null
  const standardsStatus = skillResourcesQuery.data?.standardsStatus ?? null
  const selectedSkill = catalog?.skills.find((skill) => skill.id === selectedSkillId) ?? null
  const isPreviewEnabled =
    projectPath !== null &&
    selectedSkillId !== null &&
    selectedSkill !== null &&
    selectedSkill.loadStatus !== 'error'

  const previewQuery = useQuery(
    skillPreviewQueryOptions(projectPath, selectedSkillId, isPreviewEnabled),
  )

  useEffect(() => {
    if (!projectPath) {
      setSelectedSkillId(null)
      return
    }

    const currentSkills = catalog?.skills ?? []
    setSelectedSkillId((current) => {
      if (current && currentSkills.some((skill) => skill.id === current)) {
        return current
      }
      return currentSkills[0]?.id ?? null
    })
  }, [catalog?.skills, projectPath])

  async function toggleSkill(skillId: string, enabled: boolean): Promise<void> {
    if (!projectPath) return
    toggleSkillMutation.reset()
    try {
      await toggleSkillMutation.mutateAsync({ nextProjectPath: projectPath, skillId, enabled })
    } catch {
      return
    }

    await queryClient.invalidateQueries({ queryKey: queryKeys.skills(projectPath), exact: true })
    const refreshedResources = queryClient.getQueryData<SkillResourcesResult>(
      queryKeys.skills(projectPath),
    )
    const refreshedSkills = refreshedResources?.catalog.skills ?? []
    if (selectedSkillId === skillId && refreshedSkills.some((skill) => skill.id === skillId)) {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.skillPreview(projectPath, skillId),
        exact: true,
      })
    }
  }

  async function refresh(): Promise<void> {
    if (!projectPath) return

    await queryClient.invalidateQueries({ queryKey: queryKeys.skills(projectPath), exact: true })
    const refreshedResources = queryClient.getQueryData<SkillResourcesResult>(
      queryKeys.skills(projectPath),
    )
    const refreshedSkills = refreshedResources?.catalog.skills ?? []
    if (selectedSkillId && refreshedSkills.some((skill) => skill.id === selectedSkillId)) {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.skillPreview(projectPath, selectedSkillId),
        exact: true,
      })
    }
  }

  function getErrorMessage(): string | null {
    if (skillResourcesQuery.error) {
      return describeSkillsError(skillResourcesQuery.error, 'Failed to load skills.')
    }
    if (previewQuery.error) {
      return describeSkillsError(previewQuery.error, 'Failed to load skill preview.')
    }
    if (toggleSkillMutation.error) {
      return describeSkillsError(toggleSkillMutation.error, 'Failed to update skill state.')
    }
    return null
  }

  return {
    standardsStatus,
    catalog,
    selectedSkillId,
    previewMarkdown: previewQuery.data?.markdown ?? '',
    isLoading: skillResourcesQuery.isPending,
    isPreviewLoading: previewQuery.isPending,
    error: getErrorMessage(),
    refresh,
    selectSkill: setSelectedSkillId,
    toggleSkill,
  }
}
