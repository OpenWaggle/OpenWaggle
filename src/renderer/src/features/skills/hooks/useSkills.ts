import type { SkillCatalogResult } from '@shared/types/standards'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { queryKeys } from '@/queries/query-keys'
import {
  type SkillResourcesResult,
  type StandardsStatus,
  skillPreviewQueryOptions,
  skillResourcesQueryOptions,
} from '@/queries/skills'
import { api } from '@/shared/lib/ipc'

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

/**
 * The effective selection: the user's explicit pick while it still exists in the
 * catalog, otherwise the first skill. Derived per render rather than mirrored
 * into state via an effect, which would commit one render holding a selection
 * that no longer exists (react-doctor/no-adjust-state-on-prop-change).
 */
function resolveSelectedSkillId(
  projectPath: string | null,
  explicitSkillId: string | null,
  skills: readonly { readonly id: string }[],
) {
  if (projectPath === null) return null
  if (explicitSkillId && skills.some((skill) => skill.id === explicitSkillId)) {
    return explicitSkillId
  }
  return skills[0]?.id ?? null
}

function describeSkillsError(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

export function useSkills(projectPath: string | null): UseSkillsResult {
  const queryClient = useQueryClient()
  const [explicitSkillId, setExplicitSkillId] = useState<string | null>(null)
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
    // Invalidate on the mutation itself so every caller refreshes the catalog,
    // not just the toggleSkill wrapper. mutateAsync awaits onSuccess, so callers
    // still observe fresh data immediately after awaiting
    // (react-doctor/query-mutation-missing-invalidation).
    onSuccess: (_result, variables) =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.skills(variables.nextProjectPath),
        exact: true,
      }),
  })

  const catalog = skillResourcesQuery.data?.catalog ?? null
  const standardsStatus = skillResourcesQuery.data?.standardsStatus ?? null
  const selectedSkillId = resolveSelectedSkillId(
    projectPath,
    explicitSkillId,
    catalog?.skills ?? [],
  )
  const selectedSkill = catalog?.skills.find((skill) => skill.id === selectedSkillId) ?? null
  const isPreviewEnabled =
    projectPath !== null &&
    selectedSkillId !== null &&
    selectedSkill !== null &&
    selectedSkill.loadStatus !== 'error'

  const previewQuery = useQuery(
    skillPreviewQueryOptions(projectPath, selectedSkillId, isPreviewEnabled),
  )

  async function toggleSkill(skillId: string, enabled: boolean) {
    if (!projectPath) return
    toggleSkillMutation.reset()
    try {
      await toggleSkillMutation.mutateAsync({ nextProjectPath: projectPath, skillId, enabled })
    } catch {
      return
    }

    // The mutation's onSuccess already invalidated the catalog.
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

  async function refresh() {
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

  function getErrorMessage() {
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
    selectSkill: setExplicitSkillId,
    toggleSkill,
  }
}
