import type { McpServerId } from '@shared/types/brand'
import type { McpServerConfig, McpServerStatus } from '@shared/types/mcp'
import { LayoutGrid, Plug, Plus } from 'lucide-react'
import { useState } from 'react'
import { createRendererLogger } from '@/lib/logger'
import { McpRegistryCard } from './McpRegistryCard'
import { McpServerCard } from './McpServerCard'

interface McpRegistryEntry {
  readonly name: string
  readonly icon: 'globe' | 'message-square' | 'shield-alert' | 'chrome' | 'wrench'
  readonly description: string
  readonly popular: boolean
  readonly config: Omit<McpServerConfig, 'id'> | null
}

interface McpListViewProps {
  readonly servers: readonly McpServerStatus[]
  readonly isLoading: boolean
  readonly loadError: string | null
  readonly actionError: string | null
  readonly onAddClick: () => void
  readonly onInstall: (
    config: Omit<McpServerConfig, 'id'>,
  ) => Promise<{ ok: boolean; error?: string }>
  readonly onToggle: (id: McpServerId, enabled: boolean) => Promise<void>
  readonly onRemove: (id: McpServerId) => Promise<void>
}

const REGISTRY_ENTRIES: readonly McpRegistryEntry[] = [
  {
    name: 'Playwright',
    icon: 'globe',
    description: 'Browser automation with accessibility snapshots and page interactions',
    popular: true,
    config: {
      name: 'playwright',
      transport: 'stdio',
      enabled: true,
      command: 'npx',
      args: ['@playwright/mcp@latest'],
    },
  },
  {
    name: 'Chrome DevTools',
    icon: 'chrome',
    description: 'Inspect, debug, and profile live Chrome browser sessions',
    popular: true,
    config: {
      name: 'chrome-devtools',
      transport: 'stdio',
      enabled: true,
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
    },
  },
  {
    name: 'Puppeteer',
    icon: 'globe',
    description: 'Browser automation with headless Chrome control',
    popular: false,
    config: {
      name: 'puppeteer',
      transport: 'stdio',
      enabled: true,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    },
  },
  {
    name: 'Slack',
    icon: 'message-square',
    description: 'Send messages, manage channels and Slack integrations',
    popular: false,
    config: null,
  },
  {
    name: 'Sentry',
    icon: 'shield-alert',
    description: 'Monitor errors, track performance and manage alerts',
    popular: false,
    config: null,
  },
]

const logger = createRendererLogger('mcp/list-view')

export function McpListView({
  servers,
  isLoading,
  loadError,
  actionError,
  onAddClick,
  onInstall,
  onToggle,
  onRemove,
}: McpListViewProps): React.JSX.Element {
  const [installingName, setInstallingName] = useState<string | null>(null)

  const connectedServers = servers.filter(
    (s) => s.status === 'connected' || s.status === 'connecting',
  )
  const connectedCount = servers.filter((s) => s.status === 'connected').length

  const installedNames = new Set(servers.map((s) => s.name))
  const availableEntries = REGISTRY_ENTRIES.filter(
    (entry) => !installedNames.has(entry.config?.name ?? entry.name.toLowerCase()),
  )

  async function handleInstall(entry: McpRegistryEntry): Promise<void> {
    if (!entry.config) return
    setInstallingName(entry.config.name)
    const result = await onInstall(entry.config).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to install MCP registry entry', {
        serverName: entry.config?.name,
        error: message,
      })
      return null
    })
    if (result && !result.ok) {
      logger.warn('MCP install returned non-ok result', {
        serverName: entry.config.name,
        error: result.error,
      })
    }
    setInstallingName(null)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-bg">
      {/* Top bar */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-8">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-text-primary">MCPs</h1>
          <span className="rounded-[10px] bg-bg-tertiary px-2.5 py-0.5 text-[11px] font-medium text-text-tertiary">
            {connectedCount} connected
          </span>
        </div>
        <button
          type="button"
          onClick={onAddClick}
          className="flex h-8 items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-3.5 text-[12px] font-medium text-accent transition-colors hover:bg-accent/20"
        >
          <Plus className="h-[13px] w-[13px]" />
          Add MCP
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-[13px] text-text-tertiary">Loading MCP servers...</span>
          </div>
        ) : loadError ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-[13px] text-red-400">{loadError}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {actionError && (
              <div
                role="alert"
                className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-[13px] text-error"
              >
                {actionError}
              </div>
            )}

            {/* Connected section */}
            {connectedServers.length > 0 && (
              <section className="flex flex-col gap-3">
                <div className="flex items-center gap-1.5">
                  <Plug className="h-[13px] w-[13px] text-text-tertiary" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.8px] text-text-tertiary">
                    Connected
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {connectedServers.map((server) => (
                    <McpServerCard
                      key={server.id}
                      server={server}
                      onToggle={(enabled) => void onToggle(server.id, enabled)}
                      onRemove={() => void onRemove(server.id)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Disconnected servers */}
            {servers.filter((s) => s.status === 'disconnected' || s.status === 'error').length >
              0 && (
              <section className="flex flex-col gap-3">
                <div className="flex items-center gap-1.5">
                  <Plug className="h-[13px] w-[13px] text-text-tertiary" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.8px] text-text-tertiary">
                    Disconnected
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {servers
                    .filter((s) => s.status === 'disconnected' || s.status === 'error')
                    .map((server) => (
                      <McpServerCard
                        key={server.id}
                        server={server}
                        onToggle={(enabled) => void onToggle(server.id, enabled)}
                        onRemove={() => void onRemove(server.id)}
                      />
                    ))}
                </div>
              </section>
            )}

            {/* Registry section */}
            {availableEntries.length > 0 && (
              <section className="flex flex-col gap-3">
                <div className="flex items-center gap-1.5">
                  <LayoutGrid className="h-[13px] w-[13px] text-text-tertiary" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.8px] text-text-tertiary">
                    Registry
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {availableEntries.map((entry) => (
                    <McpRegistryCard
                      key={entry.name}
                      name={entry.name}
                      icon={entry.icon}
                      description={entry.description}
                      popular={entry.popular}
                      isInstalling={installingName === entry.config?.name}
                      onInstall={() => void handleInstall(entry)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
