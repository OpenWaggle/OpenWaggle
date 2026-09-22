import { MCP_CATALOG_SERVERS } from '@shared/constants/mcp'
import type { McpServerSummary } from '@shared/types/mcp'
import { Plus } from 'lucide-react'
import { Button } from '@/shared/ui/Button'

/**
 * Curated first-party catalog (ADR-0035): one-click install with zero
 * approval steps. Installing writes the definition, enables and trusts it,
 * and turns MCP on globally when it was off.
 */
export function McpCatalogPanel({
  servers,
  busy,
  onInstall,
}: {
  readonly servers: readonly McpServerSummary[]
  readonly busy: boolean
  readonly onInstall: (name: string) => void
}) {
  const installedNames = new Set(servers.map((server) => server.name))
  const available = MCP_CATALOG_SERVERS.filter((entry) => !installedNames.has(entry.name))
  if (available.length === 0) return null
  return (
    <section aria-labelledby="mcp-catalog-heading" className="space-y-3">
      <div>
        <h3 id="mcp-catalog-heading" className="text-base font-semibold text-text-primary">
          Recommended servers
        </h3>
        <p className="mt-1 text-xs text-text-tertiary">
          One click installs, enables, and connects — no extra approvals. Installing also turns MCP
          on globally if it was off.
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-bg">
        {available.map((entry) => (
          <div
            key={entry.name}
            className="flex items-center justify-between gap-4 border-b border-border px-4 py-3.5 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary">{entry.title}</p>
              <p className="mt-0.5 truncate text-xs text-text-tertiary">{entry.description}</p>
            </div>
            <Button
              variant="accent"
              size="xs"
              disabled={busy}
              leftIcon={<Plus className="size-3" />}
              onClick={() => onInstall(entry.name)}
            >
              Install
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}
