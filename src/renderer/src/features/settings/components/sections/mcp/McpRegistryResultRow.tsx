import type { McpRegistryInstallMethod, McpRegistryServerView } from '@shared/types/mcp-registry'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'

export const MCP_REGISTRY_METHOD_LABELS: Readonly<Record<McpRegistryInstallMethod, string>> = {
  remote: 'Hosted server',
  npm: 'npm package',
  pypi: 'Python package',
  nuget: 'NuGet package',
  oci: 'Docker image',
  mcpb: 'MCP bundle',
}

interface McpRegistryResultRowProps {
  readonly server: McpRegistryServerView
  /** A server with the suggested name is already configured. */
  readonly configured: boolean
  readonly installing: boolean
  readonly disabled: boolean
  readonly onInstall: (method: McpRegistryInstallMethod) => void
}

/** One Registry server, how it can run, and its Install button. */
export function McpRegistryResultRow({
  server,
  configured,
  installing,
  disabled,
  onInstall,
}: McpRegistryResultRowProps) {
  const [chosen, setChosen] = useState<McpRegistryInstallMethod | null>(null)
  const options = server.installOptions
  const method = chosen ?? options[0]?.method ?? null
  const target = options.find((option) => option.method === method)?.target
  const label = server.title ?? server.suggestedName
  return (
    <li className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-text-primary">
          {label}
          <span className="ml-1.5 font-mono text-xs font-normal text-text-muted">
            {server.name} {server.version}
          </span>
        </p>
        {server.description ? (
          <p className="text-xs text-text-tertiary">{server.description}</p>
        ) : null}
        {target ? <p className="truncate font-mono text-xs text-text-muted">{target}</p> : null}
        {options.length === 0 ? (
          <p className="text-xs text-text-muted">No way to run it that OpenWaggle supports.</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {options.length > 1 ? (
          <Select
            selectSize="xs"
            aria-label={`How to run ${label}`}
            value={method ?? undefined}
            onChange={(event) => {
              const next = options.find((option) => option.method === event.target.value)
              if (next) setChosen(next.method)
            }}
          >
            {options.map((option) => (
              <option key={option.method} value={option.method}>
                {MCP_REGISTRY_METHOD_LABELS[option.method]}
              </option>
            ))}
          </Select>
        ) : null}
        {configured ? (
          <span className="text-xs text-text-tertiary">Installed</span>
        ) : (
          <Button
            variant="accent"
            size="xs"
            aria-label={`Install ${label}`}
            disabled={disabled || method === null}
            leftIcon={<Plus className="size-3" />}
            onClick={() => {
              if (method) onInstall(method)
            }}
          >
            {installing ? 'Installing…' : 'Install'}
          </Button>
        )}
      </div>
    </li>
  )
}
