import type { AgentDefinitionCatalogItem } from '@shared/types/agent-definition'
import type { AgentDefinitionManagementCommand } from '@shared/types/agent-definition-management'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('agent-definitions')

export function useAgentDefinitions(projectPath: string | null) {
  const [catalog, setCatalog] = useState<{
    readonly projectPath: string | null
    readonly items: readonly AgentDefinitionCatalogItem[]
  }>({ projectPath: null, items: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestGeneration = useRef(0)
  const projectGeneration = useRef(0)

  const items = catalog.projectPath === projectPath ? catalog.items : []

  const reload = useCallback(async () => {
    const generation = ++requestGeneration.current
    if (!projectPath) return
    setLoading(true)
    setError(null)
    try {
      const outcome = await api.manageAgentDefinitions({ operation: 'list', projectPath })
      if (outcome.operation !== 'list') throw new Error('Unexpected Agent definition response.')
      if (requestGeneration.current !== generation) return
      setCatalog({ projectPath, items: outcome.items })
    } catch (cause) {
      if (requestGeneration.current !== generation) return
      logger.warn('Failed to list Agent definitions', { error: String(cause) })
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (requestGeneration.current === generation) setLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    projectGeneration.current += 1
    void reload()
    return () => {
      projectGeneration.current += 1
      requestGeneration.current += 1
    }
  }, [reload])

  const mutate = useCallback(
    async (command: AgentDefinitionManagementCommand) => {
      const generation = projectGeneration.current
      setError(null)
      try {
        const outcome = await api.manageAgentDefinitions(command)
        if (projectGeneration.current === generation) await reload()
        return outcome
      } catch (cause) {
        if (projectGeneration.current !== generation) throw cause
        logger.warn('Failed to manage Agent definition', { error: String(cause) })
        setError(cause instanceof Error ? cause.message : String(cause))
        throw cause
      }
    },
    [reload],
  )

  const remove = useCallback(
    async (item: AgentDefinitionCatalogItem) => {
      if (!projectPath) return
      const confirmed = await api.showConfirm(
        `Delete Agent definition “${item.name}”?`,
        `This removes only the ${item.scope} file. Existing Sessions keep their snapshots.`,
      )
      if (!confirmed) return
      await mutate({
        operation: 'delete',
        projectPath,
        name: item.name,
        scope: item.scope,
        ...(item.contentDigest ? { expectedContentDigest: item.contentDigest } : {}),
      })
    },
    [mutate, projectPath],
  )

  const refresh = useCallback(
    async (item: AgentDefinitionCatalogItem) => {
      if (!projectPath) return
      const result = await api.manageAgentDefinitions({
        operation: 'refresh-plan',
        projectPath,
        name: item.name,
      })
      if (result.operation !== 'refresh-plan') {
        throw new Error('Unexpected Agent definition refresh response.')
      }
      const { plan } = result
      if (plan.status === 'blocked') {
        throw new Error(plan.diagnostics.join(' ') || 'The imported definition cannot refresh.')
      }
      let replaceModified = false
      if (plan.status === 'conflict') {
        replaceModified = await api.showConfirm(
          `Replace local changes in “${item.name}”?`,
          'The source changed, but this imported definition was also edited locally.',
        )
        if (!replaceModified) return
      }
      await mutate({
        operation: 'refresh-apply',
        projectPath,
        name: item.name,
        expectedSourceDigest: plan.sourceDigest,
        replaceModified,
      })
    },
    [mutate, projectPath],
  )

  return { items, loading, error, reload, mutate, remove, refresh }
}
