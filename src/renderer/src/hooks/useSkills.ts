import type { AgentsInstructionStatus, SkillCatalogResult } from '@shared/types/standards'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/ipc'

interface StandardsStatus {
  agents: AgentsInstructionStatus
  agentsPath: string
  error?: string
}

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

export function useSkills(projectPath: string | null): UseSkillsResult {
  const [standardsStatus, setStandardsStatus] = useState<StandardsStatus | null>(null)
  const [catalog, setCatalog] = useState<SkillCatalogResult | null>(null)
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [previewMarkdown, setPreviewMarkdown] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!projectPath) {
      setStandardsStatus(null)
      setCatalog(null)
      setSelectedSkillId(null)
      setPreviewMarkdown('')
      setError(null)
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const [status, catalogResult] = await Promise.all([
        api.getStandardsStatus(projectPath),
        api.listSkills(projectPath),
      ])
      setStandardsStatus(status)
      setCatalog(catalogResult)
      setSelectedSkillId((current) => {
        if (current && catalogResult.skills.some((skill) => skill.id === current)) {
          return current
        }
        return catalogResult.skills[0]?.id ?? null
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load skills.')
      setStandardsStatus(null)
      setCatalog(null)
      setSelectedSkillId(null)
      setPreviewMarkdown('')
    } finally {
      setIsLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!projectPath || !selectedSkillId) {
      setPreviewMarkdown('')
      return
    }

    const skill = catalog?.skills.find((entry) => entry.id === selectedSkillId)
    if (!skill || skill.loadStatus === 'error') {
      setPreviewMarkdown('')
      return
    }

    let isMounted = true
    setIsPreviewLoading(true)
    void api
      .getSkillPreview(projectPath, selectedSkillId)
      .then((preview) => {
        if (isMounted) {
          setPreviewMarkdown(preview.markdown)
        }
      })
      .catch((previewError) => {
        if (isMounted) {
          setPreviewMarkdown('')
          setError(
            previewError instanceof Error ? previewError.message : 'Failed to load skill preview.',
          )
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsPreviewLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [projectPath, selectedSkillId, catalog])

  const toggleSkill = useCallback(
    async (skillId: string, enabled: boolean) => {
      if (!projectPath) return
      await api.setSkillEnabled(projectPath, skillId, enabled)
      await refresh()
    },
    [projectPath, refresh],
  )

  return {
    standardsStatus,
    catalog,
    selectedSkillId,
    previewMarkdown,
    isLoading,
    isPreviewLoading,
    error,
    refresh,
    selectSkill: setSelectedSkillId,
    toggleSkill,
  }
}
