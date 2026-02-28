import type { McpServerId } from '@shared/types/brand'
import type { McpServerConfig, McpServerStatus } from '@shared/types/mcp'
import { useEffect, useState } from 'react'
import { api } from '@/lib/ipc'

interface UseMcpResult {
  readonly servers: readonly McpServerStatus[]
  readonly isLoading: boolean
  readonly error: string | null
  readonly isAddFormOpen: boolean
  readonly setAddFormOpen: (open: boolean) => void
  readonly addServer: (
    config: Omit<McpServerConfig, 'id'>,
  ) => Promise<{ ok: boolean; error?: string }>
  readonly removeServer: (id: McpServerId) => Promise<void>
  readonly toggleServer: (id: McpServerId, enabled: boolean) => Promise<void>
  readonly refresh: () => Promise<void>
}

export function useMcp(): UseMcpResult {
  const [servers, setServers] = useState<McpServerStatus[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAddFormOpen, setAddFormOpen] = useState(false)

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const result = await api.listMcpServers()
        setServers(result)
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load MCP servers'
        setError(message)
      } finally {
        setIsLoading(false)
      }
    }
    void load()

    const unsubscribe = api.onMcpStatusChanged((status) => {
      setServers((prev) => {
        const idx = prev.findIndex((s) => s.id === status.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = status
          return next
        }
        return [...prev, status]
      })
    })

    return unsubscribe
  }, [])

  async function refresh(): Promise<void> {
    try {
      const result = await api.listMcpServers()
      setServers(result)
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load MCP servers'
      setError(message)
    }
  }

  async function addServer(
    config: Omit<McpServerConfig, 'id'>,
  ): Promise<{ ok: boolean; error?: string }> {
    const result = await api.addMcpServer(config)
    if (result.ok) {
      await refresh()
      setAddFormOpen(false)
    }
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  }

  async function removeServer(id: McpServerId): Promise<void> {
    await api.removeMcpServer(id)
    setServers((prev) => prev.filter((s) => s.id !== id))
  }

  async function toggleServer(id: McpServerId, enabled: boolean): Promise<void> {
    await api.toggleMcpServer(id, enabled)
  }

  return {
    servers,
    isLoading,
    error,
    isAddFormOpen,
    setAddFormOpen,
    addServer,
    removeServer,
    toggleServer,
    refresh,
  }
}
