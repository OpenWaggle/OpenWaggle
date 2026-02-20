import type { AgentsInstructionStatus, SkillCatalogResult } from '@shared/types/standards'
import { useEffect, useState } from 'react'
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
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    let active = true
    async function loadCurrentProjectSkills(refreshNonce: number): Promise<void> {
      // refreshNonce is consumed so manual refreshes re-run this effect.
      void refreshNonce

      if (!projectPath) {
        if (!active) return
        setStandardsStatus(null)
        setCatalog(null)
        setSelectedSkillId(null)
        setPreviewMarkdown('')
        setError(null)
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setError(null)
      try {
        const [status, catalogResult] = await Promise.all([
          api.getStandardsStatus(projectPath),
          api.listSkills(projectPath),
        ])
        if (!active) return
        setStandardsStatus(status)
        setCatalog(catalogResult)
        setSelectedSkillId((current) => {
          if (current && catalogResult.skills.some((skill) => skill.id === current)) {
            return current
          }
          return catalogResult.skills[0]?.id ?? null
        })
      } catch (loadError) {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : 'Failed to load skills.')
        setStandardsStatus(null)
        setCatalog(null)
        setSelectedSkillId(null)
        setPreviewMarkdown('')
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    void loadCurrentProjectSkills(refreshTick)
    return () => {
      active = false
    }
  }, [projectPath, refreshTick])

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

  async function toggleSkill(skillId: string, enabled: boolean): Promise<void> {
    if (!projectPath) return
    await api.setSkillEnabled(projectPath, skillId, enabled)
    setRefreshTick((value) => value + 1)
  }

  async function refresh(): Promise<void> {
    setRefreshTick((value) => value + 1)
  }

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
