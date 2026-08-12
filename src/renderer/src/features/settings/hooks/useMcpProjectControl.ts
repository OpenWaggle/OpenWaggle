import type { McpServerSummary, McpSettingsView } from '@shared/types/mcp'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'

/**
 * Loads the MCP settings view for the selected project and exposes the
 * per-project master + per-server mutations. Keeping this out of the component
 * keeps the render function small and its branching low.
 */
export function useMcpProjectControl(currentProject: string | null, onChanged: () => void) {
  const [detail, setDetail] = useState<McpSettingsView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!currentProject) return
    let active = true
    setError(null)
    setDetail(null)
    setLoading(true)
    void api
      .getMcpSettings({ projectPath: currentProject, sessionId: null })
      .then((next) => {
        if (active) setDetail(next)
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [currentProject])

  async function mutate(run: () => Promise<McpSettingsView | undefined>) {
    setError(null)
    try {
      const next = await run()
      if (next) setDetail(next)
      onChanged()
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError))
    }
  }

  function setProjectMaster(projectPath: string, on: boolean) {
    void mutate(async () => {
      const next = await api.setMcpScopeState({
        projectPath,
        sessionId: null,
        scope: 'project',
        state: on ? 'inherit' : 'off',
      })
      return projectPath === currentProject ? next : undefined
    })
  }

  function setServerEnabled(server: McpServerSummary, enabled: boolean) {
    if (!currentProject) return
    void mutate(() =>
      api.setMcpProjectServerEnabled({
        projectPath: currentProject,
        sessionId: null,
        instanceId: server.instanceId,
        enabled,
      }),
    )
  }

  return { detail, loading, error, setProjectMaster, setServerEnabled }
}
