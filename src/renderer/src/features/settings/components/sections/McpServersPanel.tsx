import type { McpServerPermissionGrant, McpServerSummary } from '@shared/types/mcp'
import { ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import { formatServerDetail, StatusPill, titleCase } from './McpSectionPanelPrimitives'

function TrustControls({
  server,
  busy,
  onTrust,
}: {
  readonly server: McpServerSummary
  readonly busy: boolean
  readonly onTrust: (
    trusted: boolean,
    allowUnsandboxed?: boolean,
    permissions?: McpServerPermissionGrant,
  ) => void
}) {
  const [reviewMode, setReviewMode] = useState<'sandboxed' | 'unsandboxed' | null>(null)
  if (server.trusted === 'trusted') {
    return (
      <Button variant="ghost" size="xs" disabled={busy} onClick={() => onTrust(false)}>
        Revoke trust
      </Button>
    )
  }
  if (reviewMode) {
    const { readRoots, writeRoots, allowNetwork } = server.requestedPermissions
    return (
      <div className="max-w-xl space-y-2 rounded-md border border-amber-400/30 bg-amber-400/5 p-2.5 text-[11px] text-text-secondary">
        <p className="font-medium text-amber-200">
          Approve these permissions for this exact configuration
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
          <dt>Read</dt>
          <dd>{readRoots.length > 0 ? readRoots.join(', ') : 'No project paths'}</dd>
          <dt>Write</dt>
          <dd>{writeRoots.length > 0 ? writeRoots.join(', ') : 'Isolated temporary space only'}</dd>
          <dt>Network</dt>
          <dd>{allowNetwork ? 'Outbound access requested' : 'Denied'}</dd>
          <dt>Sandbox</dt>
          <dd>
            {reviewMode === 'unsandboxed'
              ? 'Disabled — the process receives host user authority'
              : 'Required'}
          </dd>
        </dl>
        <p className="leading-4 text-text-tertiary">
          Config changes revoke this approval. Server output and MCP content remain untrusted.
        </p>
        <div className="flex gap-1.5">
          <Button
            variant={reviewMode === 'unsandboxed' ? 'danger' : 'accent'}
            size="xs"
            disabled={busy}
            onClick={() => onTrust(true, reviewMode === 'unsandboxed', server.requestedPermissions)}
          >
            Approve permissions and trust
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setReviewMode(null)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="accent" size="xs" disabled={busy} onClick={() => setReviewMode('sandboxed')}>
        Review & trust
      </Button>
      {server.transport === 'stdio' && (
        <Button
          variant="secondary"
          size="xs"
          disabled={busy}
          title="Only use when this platform cannot provide process sandboxing"
          onClick={() => setReviewMode('unsandboxed')}
        >
          Trust unsandboxed
        </Button>
      )}
    </div>
  )
}

function ServerBadges({ server }: { readonly server: McpServerSummary }) {
  const isLegacy =
    (server.compatibility !== 'auto' && server.compatibility !== 'modern-only') ||
    (server.negotiatedProtocolVersion !== undefined &&
      server.negotiatedProtocolVersion !== '2026-07-28')
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[13px] font-medium text-text-primary">{server.name}</span>
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
      <span className="text-[11px] text-error">Remove from {server.sourceLabel}?</span>
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
  readonly onTrust: (
    trusted: boolean,
    allowUnsandboxed?: boolean,
    permissions?: McpServerPermissionGrant,
  ) => void
  readonly onRemove: () => void
  readonly onAuthorize: () => void
  readonly onLogout: () => void
}) {
  return (
    <div className="border-b border-border px-4 py-3.5 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <ServerBadges server={server} />
          <p className="mt-1 truncate text-[12px] text-text-tertiary">
            {formatServerDetail(server)}
          </p>
          <p className="mt-1 truncate text-[11px] text-text-muted">
            {titleCase(server.transport)} · {server.sourceLabel}
            {server.negotiatedProtocolVersion && ` · MCP ${server.negotiatedProtocolVersion}`}
          </p>
          {server.capabilities.length > 0 && (
            <p className="mt-1 text-[11px] text-text-tertiary">
              {server.capabilities.map(titleCase).join(' · ')}
            </p>
          )}
          {(server.blockedReason || server.lastError) && (
            <p className="mt-2 text-[11px] leading-4 text-amber-300">
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
          <TrustControls server={server} busy={busy} onTrust={onTrust} />
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
    permissions?: McpServerPermissionGrant,
  ) => void
  readonly onRemoveServer: (server: McpServerSummary) => void
  readonly onAuthorizeServer: (server: McpServerSummary) => void
  readonly onLogoutServer: (server: McpServerSummary) => void
}) {
  return (
    <section aria-labelledby="mcp-servers-heading" className="space-y-3">
      <div>
        <h3 id="mcp-servers-heading" className="text-[15px] font-semibold text-text-primary">
          Servers
        </h3>
        <p className="mt-1 text-[12px] text-text-tertiary">
          Enablement controls selection. Trust authorizes the exact configuration hash; edits revoke
          that trust automatically.
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-[#111418]">
        {servers.length > 0 ? (
          servers.map((server) => (
            <ServerRow
              key={server.instanceId}
              server={server}
              busy={busy}
              onToggle={() => onToggleServer(server)}
              onTrust={(trusted, allowUnsandboxed, permissions) =>
                onTrustServer(server, trusted, allowUnsandboxed, permissions)
              }
              onRemove={() => onRemoveServer(server)}
              onAuthorize={() => onAuthorizeServer(server)}
              onLogout={() => onLogoutServer(server)}
            />
          ))
        ) : (
          <p className="px-4 py-6 text-[13px] text-text-muted">No MCP servers configured.</p>
        )}
      </div>
    </section>
  )
}
