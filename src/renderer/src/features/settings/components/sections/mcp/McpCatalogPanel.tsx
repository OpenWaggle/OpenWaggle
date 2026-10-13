import { MCP_CATALOG_SERVERS } from '@shared/constants/mcp'
import type { McpConfigFileScope, McpConfigurationView } from '@shared/types/mcp-configuration'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { useMcpConfigurationActions } from '../../../hooks/useMcpConfiguration'
import { McpInlineError } from './McpLabels'

function entryCommand(entry: (typeof MCP_CATALOG_SERVERS)[number]['entry']) {
  const args = Array.isArray(entry.args) ? entry.args.filter((arg) => typeof arg === 'string') : []
  return typeof entry.command === 'string' ? [entry.command, ...args].join(' ') : ''
}

/** One click saves an ordinary entry to OpenWaggle's file; it then works like any other server. */
export function McpCatalogPanel({ view }: { readonly view: McpConfigurationView }) {
  const actions = useMcpConfigurationActions(view.projectPath)
  const [scope, setScope] = useState<McpConfigFileScope>('global')
  const configured = new Set(view.servers.map((server) => server.name))
  return (
    <section aria-labelledby="mcp-catalog-heading" className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 id="mcp-catalog-heading" className="text-sm font-semibold text-text-primary">
            Recommended servers
          </h3>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Installing adds the server to OpenWaggle&apos;s file.
          </p>
        </div>
        <Select
          selectSize="xs"
          aria-label="Install for"
          value={scope}
          onChange={(event) => setScope(event.target.value === 'project' ? 'project' : 'global')}
        >
          <option value="global">All projects</option>
          <option value="project" disabled={view.projectPath === null}>
            This project
          </option>
        </Select>
      </div>
      <ul className="overflow-hidden rounded-lg border border-border bg-bg">
        {MCP_CATALOG_SERVERS.map((item) => (
          <li
            key={item.name}
            className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary">{item.title}</p>
              <p className="truncate text-xs text-text-tertiary">{item.description}</p>
              <p className="truncate font-mono text-xs text-text-muted">
                {entryCommand(item.entry)}
              </p>
            </div>
            {configured.has(item.name) ? (
              <span className="text-xs text-text-tertiary">Installed</span>
            ) : (
              <Button
                variant="accent"
                size="xs"
                aria-label={`Install ${item.title}`}
                disabled={actions.pending}
                leftIcon={<Plus className="size-3" />}
                onClick={() => void actions.installCatalogServer(item.name, scope)}
              >
                Install
              </Button>
            )}
          </li>
        ))}
      </ul>
      <McpInlineError message={actions.error} />
    </section>
  )
}
