import type { McpServerSummary } from '@shared/types/mcp'
import { ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import { formatServerDetail, StatusPill, titleCase } from './McpSectionPanelPrimitives'

function UnsandboxedControl({
  server,
  busy,
  onTrust,
}: {
  readonly server: McpServerSummary
  readonly busy: boolean
  readonly onTrust: (trusted: boolean, allowUnsandboxed?: boolean) => void
}) {
  // Escape hatch for platforms without a usable OS sandbox (ADR-0014/0035).
  if (server.transport !== 'stdio') return null
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={busy}
      title="Only use when this platform cannot provide process sandboxing"
      onClick={() => onTrust(true, true)}
    >
      Run unsandboxed
    </Button>
  )
}

function ServerBadges({ server }: { readonly server: McpServerSummary }) {
  const isLegacy =
    (server.compatibility !== 'auto' && server.compatibility !== 'modern-only') ||
    (server.negotiatedProtocolVersion !== undefined &&
      server.negotiatedProtocolVersion !== '2026-07-28')
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-text-primary">{server.name}</span>
      <StatusPill tone={server.trusted === 'trusted' ? 'success' : 'warning'}>
        {server.trusted === 'trusted' ? (
          <ShieldCheck className="size-3" />
        ) : (
          <ShieldAlert className="size-3" />
        )}
        {titleCase(server.trusted)}
      </StatusPill>
      <StatusPill tone={server.connectionState === 'connected' ? 'success' : 'neutral'}>
        {titleCase(server.connectionState)}
      </StatusPill>
      <StatusPill tone={isLegacy ? 'warning' : 'neutral'}>
        {isLegacy ? 'Legacy compatibility' : titleCase(server.compatibility)}
      </StatusPill>
      {server.required && <StatusPill tone="error">Required</StatusPill>}
      {server.trustChanged && <StatusPill tone="warning">Config changed</StatusPill>}
      {server.auth === 'oauth' && <StatusPill tone="accent">OAuth</StatusPill>}
    </div>
  )
}

function RemoveControls({
  server,
  busy,
  onRemove,
}: {
  readonly server: McpServerSummary
  readonly busy: boolean
  readonly onRemove: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="xs"
        disabled={busy}
        onClick={() => setConfirming(true)}
        leftIcon={<Trash2 className="size-3" />}
      >
        Remove
      </Button>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-error-text">Remove from {server.sourceLabel}?</span>
      <Button variant="danger" size="xs" disabled={busy} onClick={onRemove}>
        Confirm remove
      </Button>
      <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  )
}

function ServerRow({
  server,
  busy,
  onToggle,
  onTrust,
  onRemove,
  onAuthorize,
  onLogout,
}: {
  readonly server: McpServerSummary
  readonly busy: boolean
  readonly onToggle: () => void
  readonly onTrust: (trusted: boolean, allowUnsandboxed?: boolean) => void
  readonly onRemove: () => void
  readonly onAuthorize: () => void
  readonly onLogout: () => void
}) {
  return (
    <div className="border-b border-border px-4 py-3.5 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <ServerBadges server={server} />
          <p className="mt-1 truncate text-xs text-text-tertiary">{formatServerDetail(server)}</p>
          <p className="mt-1 truncate text-xs text-text-muted">
            {titleCase(server.transport)} · {server.sourceLabel}
            {server.negotiatedProtocolVersion && ` · MCP ${server.negotiatedProtocolVersion}`}
          </p>
          {server.capabilities.length > 0 && (
            <p className="mt-1 text-xs text-text-tertiary">
              {server.capabilities.map(titleCase).join(' · ')}
            </p>
          )}
          {(server.blockedReason || server.lastError) && (
            <p className="mt-2 text-xs leading-4 text-warning">
              {server.blockedReason ?? server.lastError}
            </p>
          )}
        </div>
        <ToggleSwitch
          checked={server.enabled}
          disabled={busy}
          label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name}`}
          onCheckedChange={onToggle}
        />
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-2.5">
        <div className="flex items-center gap-1.5">
          <UnsandboxedControl server={server} busy={busy} onTrust={onTrust} />
          {server.auth === 'oauth' && (
            <>
              <Button variant="secondary" size="xs" disabled={busy} onClick={onAuthorize}>
                Authorize / refresh
              </Button>
              <Button variant="ghost" size="xs" disabled={busy} onClick={onLogout}>
                Clear OAuth
              </Button>
            </>
          )}
        </div>
        <RemoveControls server={server} busy={busy} onRemove={onRemove} />
      </div>
    </div>
  )
}

export function McpServersPanel({
  servers,
  busy,
  onToggleServer,
  onTrustServer,
  onRemoveServer,
  onAuthorizeServer,
  onLogoutServer,
}: {
  readonly servers: readonly McpServerSummary[]
  readonly busy: boolean
  readonly onToggleServer: (server: McpServerSummary) => void
  readonly onTrustServer: (
    server: McpServerSummary,
    trusted: boolean,
    allowUnsandboxed?: boolean,
  ) => void
  readonly onRemoveServer: (server: McpServerSummary) => void
  readonly onAuthorizeServer: (server: McpServerSummary) => void
  readonly onLogoutServer: (server: McpServerSummary) => void
}) {
  return (
    <section aria-labelledby="mcp-servers-heading" className="space-y-3">
      <div>
        <h3 id="mcp-servers-heading" className="text-base font-semibold text-text-primary">
          Servers
        </h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Enabling a server trusts its current configuration and connects it with derived grants
          (network for package-runner and remote servers). Config changes reconnect automatically.
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-bg">
        {servers.length > 0 ? (
          servers.map((server) => (
            <ServerRow
              key={server.instanceId}
              server={server}
              busy={busy}
              onToggle={() => onToggleServer(server)}
              onTrust={(trusted, allowUnsandboxed) =>
                onTrustServer(server, trusted, allowUnsandboxed)
              }
              onRemove={() => onRemoveServer(server)}
              onAuthorize={() => onAuthorizeServer(server)}
              onLogout={() => onLogoutServer(server)}
            />
          ))
        ) : (
          <p className="px-4 py-6 text-xs text-text-muted">No MCP servers configured.</p>
        )}
      </div>
    </section>
  )
}
