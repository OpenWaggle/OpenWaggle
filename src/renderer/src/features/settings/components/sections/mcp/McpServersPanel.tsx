import type { McpConfigurationView } from '@shared/types/mcp-configuration'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { mcpQueryKeys } from '@/queries/mcp-configuration'
import { Button } from '@/shared/ui/Button'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'
import { useMcpConfiguration, useMcpConfigurationActions } from '../../../hooks/useMcpConfiguration'
import { McpAddServerForm } from './McpAddServerForm'
import { McpCatalogPanel } from './McpCatalogPanel'
import { McpImportPanel } from './McpImportPanel'
import { McpFileName, McpInlineError } from './McpLabels'
import { McpRegistryPanel } from './McpRegistryPanel'
import { McpSecretsPanel } from './McpSecretsPanel'
import { McpServerDetail } from './McpServerDetail'
import { McpServerList } from './McpServerList'

type OpenPanel = 'add' | 'import' | null

function ConfigErrors({ errors }: { readonly errors: readonly string[] }) {
  if (errors.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-error-text">
        Some MCP configuration could not be read:
      </p>
      <PlainTextBlock reason="error" ariaLabel="Configuration errors">
        {errors.join('\n')}
      </PlainTextBlock>
    </div>
  )
}

type OrphanedOverride = NonNullable<McpConfigurationView['orphanedOverrides']>[number]

/** An override OpenWaggle wrote for a server no file defines any more, which can be removed. */
function OrphanedOverrideAction({
  projectPath,
  orphan,
}: {
  readonly projectPath: string | null
  readonly orphan: OrphanedOverride
}) {
  const actions = useMcpConfigurationActions(projectPath)
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="min-w-0 truncate text-xs text-text-secondary" title={orphan.path}>
        &quot;{orphan.name}&quot; in <McpFileName fileId={orphan.fileId} />
      </p>
      <Button
        variant="secondary"
        size="xs"
        disabled={actions.pending}
        aria-label={`Remove override for ${orphan.name}`}
        onClick={() => void actions.removeServer(orphan.name)}
      >
        Remove override
      </Button>
      <McpInlineError message={actions.error} />
    </div>
  )
}

function ConfigWarnings({
  projectPath,
  warnings,
  orphans,
}: {
  readonly projectPath: string | null
  readonly warnings: readonly string[]
  readonly orphans: readonly OrphanedOverride[]
}) {
  if (warnings.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-text-tertiary">Ignored, nothing else is affected:</p>
      <PlainTextBlock reason="log" ariaLabel="Ignored MCP configuration">
        {warnings.join('\n')}
      </PlainTextBlock>
      {orphans.map((orphan) => (
        <OrphanedOverrideAction
          key={`${orphan.path}:${orphan.name}`}
          projectPath={projectPath}
          orphan={orphan}
        />
      ))}
    </div>
  )
}

export function McpServersPanel({ projectPath }: { readonly projectPath: string | null }) {
  const queryClient = useQueryClient()
  const configuration = useMcpConfiguration(projectPath)
  const [selected, setSelected] = useState<string | null>(null)
  const [panel, setPanel] = useState<OpenPanel>(null)
  const selectedRow = configuration.rows.find((row) => row.server.name === selected)
  const { view } = configuration

  if (selectedRow) {
    return (
      <McpServerDetail
        projectPath={projectPath}
        row={selectedRow}
        files={view?.files ?? []}
        onBack={() => setSelected(null)}
      />
    )
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="mcp-servers-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id="mcp-servers-heading" className="text-sm font-semibold text-text-primary">
            Servers
          </h3>
          <div className="flex gap-1.5">
            <Button
              variant="ghost"
              size="xs"
              leftIcon={<RefreshCw className="size-3" />}
              onClick={() => {
                void queryClient.invalidateQueries({
                  queryKey: mcpQueryKeys.configuration(projectPath),
                })
                void queryClient.invalidateQueries({
                  queryKey: mcpQueryKeys.statuses(projectPath),
                })
              }}
            >
              Refresh
            </Button>
            <Button
              variant="secondary"
              size="xs"
              leftIcon={<Download className="size-3" />}
              onClick={() => setPanel(panel === 'import' ? null : 'import')}
            >
              Import
            </Button>
            <Button
              variant="secondary"
              size="xs"
              leftIcon={<Plus className="size-3" />}
              disabled={!view}
              onClick={() => setPanel(panel === 'add' ? null : 'add')}
            >
              Add server
            </Button>
          </div>
        </div>
        {panel === 'add' && view ? (
          <McpAddServerForm
            view={view}
            onDone={(name) => {
              setPanel(null)
              if (name) setSelected(name)
            }}
          />
        ) : null}
        {panel === 'import' ? (
          <McpImportPanel projectPath={projectPath} onClose={() => setPanel(null)} />
        ) : null}
        <McpInlineError message={configuration.loadError} />
        <ConfigErrors errors={view?.errors ?? []} />
        <ConfigWarnings
          projectPath={projectPath}
          warnings={view?.warnings ?? []}
          orphans={view?.orphanedOverrides ?? []}
        />
        {configuration.isLoading ? (
          <p className="text-xs text-text-tertiary">Loading servers…</p>
        ) : (
          <McpServerList rows={configuration.rows} onOpen={setSelected} />
        )}
      </section>
      {view ? <McpCatalogPanel view={view} /> : null}
      <McpRegistryPanel projectPath={projectPath} />
      <McpSecretsPanel />
    </div>
  )
}
