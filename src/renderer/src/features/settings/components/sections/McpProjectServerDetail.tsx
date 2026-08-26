import type { McpServerSummary } from '@shared/types/mcp'
import { cn } from '@/shared/lib/cn'
import { tildifyPath } from '@/shared/lib/tildify-path'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import { StatusPill } from './McpSectionPanelPrimitives'

export function isSharedServer(server: McpServerSummary) {
  return server.sourceId.startsWith('global')
}

function serverGlobalHint(server: McpServerSummary): string | null {
  if (!server.enabled) return 'Disabled globally'
  if (server.trusted !== 'trusted') return 'Not trusted globally'
  return null
}

function ServerRow({
  server,
  disabled,
  onToggle,
}: {
  readonly server: McpServerSummary
  readonly disabled: boolean
  readonly onToggle: (server: McpServerSummary, enabled: boolean) => void
}) {
  const hint = serverGlobalHint(server)
  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-text-primary">{server.name}</div>
        {hint && <div className="text-xs text-text-muted">{hint}</div>}
      </div>
      <StatusPill tone={isSharedServer(server) ? 'accent' : 'neutral'}>
        {isSharedServer(server) ? 'shared' : 'project'}
      </StatusPill>
      {server.required ? (
        <StatusPill tone="success">Required</StatusPill>
      ) : (
        <ToggleSwitch
          size="compact"
          checked={server.projectEnabled}
          disabled={disabled}
          label={`${server.projectEnabled ? 'Disable' : 'Enable'} ${server.name} for this project`}
          onCheckedChange={(next) => onToggle(server, next)}
        />
      )}
    </div>
  )
}

function ServerGroup({
  title,
  servers,
  disabled,
  onToggle,
}: {
  readonly title: string
  readonly servers: readonly McpServerSummary[]
  readonly disabled: boolean
  readonly onToggle: (server: McpServerSummary, enabled: boolean) => void
}) {
  return (
    <div>
      <div className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
        {title}
      </div>
      {servers.length === 0 ? (
        <div className="px-4 py-2.5 text-xs text-text-muted">No servers.</div>
      ) : (
        servers.map((server) => (
          <ServerRow
            key={server.instanceId}
            server={server}
            disabled={disabled}
            onToggle={onToggle}
          />
        ))
      )}
    </div>
  )
}

/** Right pane: the selected project's servers (shared global + its own) with per-project toggles. */
export function McpProjectServerDetail({
  label,
  projectPath,
  servers,
  masterOn,
  busy,
  loading,
  onSetMaster,
  onToggleServer,
}: {
  readonly label: string
  readonly projectPath: string
  readonly servers: readonly McpServerSummary[]
  readonly masterOn: boolean
  readonly busy: boolean
  readonly loading: boolean
  readonly onSetMaster: (on: boolean) => void
  readonly onToggleServer: (server: McpServerSummary, enabled: boolean) => void
}) {
  const shared = servers.filter(isSharedServer)
  const own = servers.filter((server) => !isSharedServer(server))
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-text-primary">{label}</div>
          <div className="truncate text-xs text-text-muted">{tildifyPath(projectPath)}</div>
        </div>
        <span className="text-xs text-text-tertiary">project MCP</span>
        <ToggleSwitch
          checked={masterOn}
          disabled={busy}
          label={masterOn ? 'Disable MCP for this project' : 'Enable MCP for this project'}
          onCheckedChange={onSetMaster}
        />
      </div>
      <div className={cn(!masterOn && 'pointer-events-none opacity-40')}>
        {loading ? (
          <div className="px-4 py-6 text-center text-xs text-text-muted">Loading…</div>
        ) : (
          <>
            <ServerGroup
              title="Shared (from Global)"
              servers={shared}
              disabled={busy || !masterOn}
              onToggle={onToggleServer}
            />
            <ServerGroup
              title={`${label} servers`}
              servers={own}
              disabled={busy || !masterOn}
              onToggle={onToggleServer}
            />
          </>
        )}
      </div>
    </div>
  )
}
