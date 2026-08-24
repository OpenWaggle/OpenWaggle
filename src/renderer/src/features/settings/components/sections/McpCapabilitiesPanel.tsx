import type { McpCapabilityCatalog, McpServerSummary } from '@shared/types/mcp'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { McpCapabilityCatalogGroups } from './McpCapabilityCatalog'
import { McpEventInbox } from './McpEventInbox'

const EMPTY_CATALOG: McpCapabilityCatalog = {
  instructions: [],
  prompts: [],
  resources: [],
  resourceTemplates: [],
  apps: [],
  tasks: [],
  skills: [],
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function catalogIsEmpty(catalog: McpCapabilityCatalog) {
  return (
    catalog.prompts.length === 0 &&
    catalog.instructions.length === 0 &&
    catalog.resources.length === 0 &&
    catalog.apps.length === 0 &&
    catalog.tasks.length === 0 &&
    catalog.skills.length === 0
  )
}

export function McpCapabilitiesPanel({
  projectPath,
  sessionId,
  enabled,
  servers,
}: {
  readonly projectPath: string | null
  readonly sessionId: string | null
  readonly enabled: boolean
  readonly servers: readonly McpServerSummary[]
}) {
  const [catalog, setCatalog] = useState<McpCapabilityCatalog>(EMPTY_CATALOG)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const context = { projectPath, sessionId }

  async function refresh() {
    setBusy(true)
    setError(null)
    try {
      setCatalog(await api.listMcpCapabilities(context))
      setLoaded(true)
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="mcp-capabilities-heading" className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id="mcp-capabilities-heading" className="text-[15px] font-semibold text-text-primary">
            Capabilities
          </h3>
          <p className="mt-1 text-[12px] text-text-tertiary">
            Browsing is explicit and lazy. Prompts create drafts; resources remain attributed and
            untrusted.
          </p>
        </div>
        <Button
          type="button"
          disabled={busy || !enabled || !projectPath}
          leftIcon={<RefreshCw className="size-3" />}
          onClick={() => void refresh()}
        >
          {loaded ? 'Refresh capabilities' : 'Load capabilities'}
        </Button>
      </div>
      {!enabled && (
        <p className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-[12px] text-text-muted">
          Enable MCP for this scope before connecting to browse capabilities.
        </p>
      )}
      <p className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-[12px] leading-5 text-text-muted">
        Agent MCP tools follow the runtime&apos;s tool-capable model contract; OpenWaggle does not
        guess from model names. If a custom provider violates that contract, the run fails visibly.
        Switch to a conforming model or fix the provider; prompts, resources, and Apps remain
        available here.
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-error/25 bg-error/6 px-3 py-2 text-[12px] text-error"
        >
          {error}
        </p>
      )}
      {loaded && catalogIsEmpty(catalog) && (
        <p className="rounded-md border border-border bg-bg-secondary px-3 py-3 text-[12px] text-text-muted">
          No instructions, prompts, resources, Apps, Tasks, or opted-in remote Skills were
          advertised by the connected servers.
        </p>
      )}
      <McpCapabilityCatalogGroups
        catalog={catalog}
        context={context}
        onTasksChanged={() => void refresh()}
      />
      <McpEventInbox
        context={context}
        servers={servers}
        resources={catalog.resources}
        enabled={enabled}
      />
    </section>
  )
}
