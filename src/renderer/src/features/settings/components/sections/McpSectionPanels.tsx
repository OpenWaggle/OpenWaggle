import { MCP_ADAPTER_PACKAGE_SOURCE } from '@shared/constants/mcp'
import type {
  McpConfigSourceId,
  McpConfigSourceSummary,
  McpServerSummary,
  McpSettingsView,
} from '@shared/types/mcp'
import { AlertTriangle, CheckCircle2, Network, RotateCw } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'

function formatServerDetail(server: McpServerSummary) {
  if (server.transport === 'http' && server.url) return server.url
  if (server.transport === 'stdio' && server.command) return server.command
  return 'No transport configured'
}

function formatDirectTools(mode: McpServerSummary['directTools']) {
  if (mode === 'enabled') return 'Direct tools'
  if (mode === 'partial') return 'Selected direct tools'
  if (mode === 'disabled') return 'Proxy only'
  return 'Inherits direct-tools setting'
}

function SourceButton({
  source,
  selected,
  onSelect,
}: {
  readonly source: McpConfigSourceSummary
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  const statusLabel = source.parseError ? 'Invalid' : source.exists ? 'Found' : 'Empty'
  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={onSelect}
      className={cn(
        'rounded-lg border p-3 text-left transition-colors',
        selected
          ? 'border-accent/40 bg-accent/5 text-text-primary'
          : 'border-border bg-bg hover:border-border-light text-text-secondary',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">{source.label}</div>
          <div className="mt-1 truncate text-[11px] text-text-muted">{source.path}</div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
            source.parseError
              ? 'bg-error/10 text-error'
              : source.exists
                ? 'bg-emerald-500/10 text-emerald-300'
                : 'bg-bg-tertiary text-text-muted',
          )}
        >
          {statusLabel}
        </span>
      </div>
      {source.parseError ? (
        <div className="mt-2 line-clamp-2 text-[11px] text-error">{source.parseError}</div>
      ) : (
        <div className="mt-2 flex gap-2 text-[11px] text-text-tertiary">
          <span>{source.serverCount} active</span>
          <span>{source.disabledServerCount} disabled</span>
        </div>
      )}
    </Button>
  )
}

function ServerRow({
  server,
  busy,
  onToggle,
}: {
  readonly server: McpServerSummary
  readonly busy: boolean
  readonly onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-text-primary">{server.name}</span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-medium',
              server.enabled
                ? 'bg-emerald-500/10 text-emerald-300'
                : 'bg-bg-tertiary text-text-muted',
            )}
          >
            {server.enabled ? 'Enabled' : 'Disabled'}
          </span>
          <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
            {formatDirectTools(server.directTools)}
          </span>
        </div>
        <div className="mt-1 truncate text-[12px] text-text-tertiary">
          {formatServerDetail(server)}
        </div>
        <div className="mt-1 truncate text-[11px] text-text-muted">
          Source: {server.sourceLabel}
        </div>
      </div>
      <ToggleSwitch
        checked={server.enabled}
        disabled={busy}
        label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name}`}
        onCheckedChange={onToggle}
      />
    </div>
  )
}

export function McpSectionHeading() {
  return (
    <div className="space-y-1">
      <h2 className="text-[20px] font-semibold text-text-primary">MCP</h2>
      <p className="max-w-[760px] text-[13px] leading-5 text-text-tertiary">
        MCP support is powered by a Pi extension package. OpenWaggle manages the effective config
        hierarchy and Pi picks up changes on the next turn.
      </p>
    </div>
  )
}

export function McpErrorAlert({ message }: { readonly message: string | null | undefined }) {
  if (!message) return null
  return (
    <p
      role="alert"
      className="rounded-lg border border-error/25 bg-error/6 px-3 py-2 text-sm text-error"
    >
      {message}
    </p>
  )
}

function McpAdapterStatus({ enabled }: { readonly enabled: boolean }) {
  return enabled ? (
    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-300">
      <CheckCircle2 className="size-3" />
      Enabled
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded bg-bg-tertiary px-1.5 py-0.5 text-[11px] text-text-muted">
      <AlertTriangle className="size-3" />
      Off
    </span>
  )
}

export function McpAdapterCard({
  view,
  busy,
  onRefresh,
  onToggle,
}: {
  readonly view: McpSettingsView | null
  readonly busy: boolean
  readonly onRefresh: () => void
  readonly onToggle: () => void
}) {
  const adapterEnabled = view?.adapter.enabled ?? false
  return (
    <div className="rounded-lg border border-border bg-[#111418] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Network className="size-4 text-accent" />
            <h3 className="text-[16px] font-semibold text-text-primary">Pi MCP extension</h3>
            <McpAdapterStatus enabled={adapterEnabled} />
          </div>
          <p className="text-[12px] text-text-tertiary">
            Package source: {view?.adapter.packageSource ?? MCP_ADAPTER_PACKAGE_SOURCE}
          </p>
          {view?.runtimeConfigPath && (
            <p className="truncate text-[11px] text-text-muted">
              Runtime bridge config: {view.runtimeConfigPath}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button disabled={busy} onClick={onRefresh} leftIcon={<RotateCw className="size-3" />}>
            Refresh
          </Button>
          <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-1.5">
            <span className="text-[12px] font-medium text-text-secondary">
              {adapterEnabled ? 'On' : 'Off'}
            </span>
            <ToggleSwitch
              checked={adapterEnabled}
              disabled={!view || busy}
              label={`${adapterEnabled ? 'Disable' : 'Enable'} Pi MCP extension`}
              onCheckedChange={onToggle}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export function McpSourcesPanel({
  sources,
  selectedSource,
  onSelectSource,
}: {
  readonly sources: readonly McpConfigSourceSummary[]
  readonly selectedSource: McpConfigSourceSummary | null
  readonly onSelectSource: (sourceId: McpConfigSourceId) => void
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-[16px] font-semibold text-text-primary">Sources</h3>
      <div className="grid grid-cols-2 gap-3">
        {sources.map((source) => (
          <SourceButton
            key={source.id}
            source={source}
            selected={selectedSource?.id === source.id}
            onSelect={() => onSelectSource(source.id)}
          />
        ))}
      </div>
    </div>
  )
}

export function McpServersPanel({
  servers,
  busy,
  onToggleServer,
}: {
  readonly servers: readonly McpServerSummary[]
  readonly busy: boolean
  readonly onToggleServer: (server: McpServerSummary) => void
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-[16px] font-semibold text-text-primary">Effective servers</h3>
      <div className="overflow-hidden rounded-lg border border-border bg-[#111418]">
        {servers.length > 0 ? (
          servers.map((server) => (
            <ServerRow
              key={`${server.sourceId}:${server.name}`}
              server={server}
              busy={busy}
              onToggle={() => onToggleServer(server)}
            />
          ))
        ) : (
          <p className="px-4 py-6 text-[13px] text-text-muted">No MCP servers configured.</p>
        )}
      </div>
    </div>
  )
}
