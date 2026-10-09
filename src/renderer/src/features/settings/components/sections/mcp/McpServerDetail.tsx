import type { McpConfigFileView } from '@shared/types/mcp-configuration'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatRelativeTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'
import { useMcpConfigurationActions } from '../../../hooks/useMcpConfiguration'
import type { McpServerRow } from '../../../lib/mcp-server-model'
import { mcpOverrideNote } from '../../../lib/mcp-server-model'
import { McpExposureEditor } from './McpExposureEditor'
import { McpFileLabel, McpInlineError, McpStatusPill } from './McpLabels'
import { McpMissingSecretNotice } from './McpMissingSecrets'
import { McpRemoveServer, McpServerSignIn, McpServerSwitches } from './McpServerActions'

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 text-xs">
      <dt className="text-text-tertiary">{label}</dt>
      <dd className="flex min-w-0 text-text-secondary">{children}</dd>
    </div>
  )
}

function ServerProblem({ row }: { readonly row: McpServerRow }) {
  const error = row.status === 'connected' ? undefined : row.inspection?.error
  const stderr = row.inspection?.stderrTail
  if (!error && !stderr) return null
  return (
    <div className="space-y-2">
      {error ? (
        <PlainTextBlock reason="error" ariaLabel="Connection error" className="text-error-text">
          {error}
        </PlainTextBlock>
      ) : null}
      {stderr ? (
        <PlainTextBlock reason="log" ariaLabel="Server output">
          {stderr}
        </PlainTextBlock>
      ) : null}
    </div>
  )
}

/** Where the shown state comes from, so a remembered state is not mistaken for a live one. */
function StateSource({ row }: { readonly row: McpServerRow }) {
  if (!row.server.enabled || row.status === 'checking') return null
  if (row.source === 'live') {
    return <p className="text-xs text-text-tertiary">A session is connected to this server.</p>
  }
  if (row.source === 'last-check' && row.checkedAt !== undefined) {
    return (
      <p className="text-xs text-text-tertiary">
        Last checked {formatRelativeTime(row.checkedAt)}.
      </p>
    )
  }
  return (
    <p className="text-xs text-text-tertiary">
      OpenWaggle connects only when a session uses the server or you check the connection.
    </p>
  )
}

export function McpServerDetail({
  projectPath,
  row,
  files,
  missingSecrets,
  onAddSecret,
  onBack,
}: {
  readonly projectPath: string | null
  readonly row: McpServerRow
  /** The vault secrets it reads that the vault lacks, and the way to add one. */
  readonly missingSecrets: readonly string[]
  readonly onAddSecret: (name: string) => void
  /** The view's files, which say where the server can be switched for this project. */
  readonly files: readonly McpConfigFileView[]
  readonly onBack: () => void
}) {
  const { server } = row
  const actions = useMcpConfigurationActions(projectPath)
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="xs"
          leftIcon={<ArrowLeft className="size-3" />}
          onClick={onBack}
        >
          All servers
        </Button>
        <Button
          variant="ghost"
          size="xs"
          leftIcon={<RefreshCw className="size-3" />}
          disabled={!server.enabled || row.status === 'checking'}
          onClick={() => actions.recheck(server.name)}
        >
          Check connection
        </Button>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-text-primary">{server.name}</h3>
          <McpStatusPill status={row.status} />
        </div>
        {server.description ? (
          <p className="text-xs text-text-tertiary">{server.description}</p>
        ) : null}
        <StateSource row={row} />
        <McpInlineError message={actions.error} />
      </div>
      <dl className="space-y-1.5">
        <Fact label="Starts with">
          <span className="truncate font-mono" title={server.target}>
            {server.target}
          </span>
        </Fact>
        <Fact label="Defined in">
          <McpFileLabel file={server.source} />
        </Fact>
        {server.override ? (
          <Fact label="Overridden in">
            <McpFileLabel file={server.override} />
          </Fact>
        ) : null}
      </dl>
      {mcpOverrideNote(server)?.kind === 'off-in-openwaggle' ? (
        <p className="text-xs leading-5 text-text-tertiary">
          Off in OpenWaggle: the file that defines it still has it on. OpenWaggle keeps it off
          because it did not run in OpenWaggle before the upgrade, or because you turned it off
          here. Turn it on to use it.
        </p>
      ) : null}
      <McpMissingSecretNotice missing={missingSecrets} onAddSecret={onAddSecret} />
      <ServerProblem row={row} />
      <div className="space-y-3 rounded-lg border border-border bg-bg px-4 py-3">
        <McpServerSwitches projectPath={projectPath} server={server} files={files} />
        <McpServerSignIn
          projectPath={projectPath}
          server={server}
          status={row.status}
          signedIn={row.signedIn}
        />
      </div>
      <McpExposureEditor
        projectPath={projectPath}
        server={server}
        tools={row.inspection?.tools ?? []}
      />
      <div className="border-t border-border pt-3">
        <McpRemoveServer projectPath={projectPath} server={server} onRemoved={onBack} />
      </div>
    </div>
  )
}
