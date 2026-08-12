import type {
  McpConfigSourceId,
  McpConfigSourceSummary,
  McpRuntimeNotice,
  McpSettingsView,
} from '@shared/types/mcp'
import { AlertTriangle, Network, RotateCw } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { tildifyPath } from '@/shared/lib/tildify-path'
import { Button } from '@/shared/ui/Button'
import { StatusPill, titleCase } from './McpSectionPanelPrimitives'

export { McpDoctorPanel, McpSecretVault } from './McpDiagnosticsPanels'
export { McpServersPanel } from './McpServersPanel'

export function McpSectionHeading({
  view,
  busy,
  onRefresh,
}: {
  readonly view: McpSettingsView | null
  readonly busy: boolean
  readonly onRefresh: () => void
}) {
  const integrationOn = view?.integration.desired.effective === 'on'
  return (
    <div className="flex items-start justify-between gap-5">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Network className="size-5 text-accent" />
          <h2 className="text-[20px] font-semibold text-text-primary">MCP</h2>
          {view && (
            <StatusPill tone={integrationOn ? 'success' : 'neutral'}>
              {integrationOn ? 'On' : 'Off'} · {titleCase(view.integration.desired.source)}
            </StatusPill>
          )}
        </div>
        <p className="max-w-[760px] text-[13px] leading-5 text-text-tertiary">
          Connect tools, prompts, resources, apps, and long-running tasks through OpenWaggle's
          first-party MCP runtime. Nothing starts or enters agent context while the effective scope
          is off.
        </p>
      </div>
      <Button disabled={busy} onClick={onRefresh} leftIcon={<RotateCw className="size-3" />}>
        Refresh
      </Button>
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

function noticeTone(notice: McpRuntimeNotice) {
  if (notice.severity === 'error') return 'border-error/25 bg-error/6'
  if (notice.severity === 'warning') return 'border-amber-500/20 bg-amber-500/5'
  return 'border-border bg-[#111418]'
}

export function McpNoticesPanel({ notices }: { readonly notices: readonly McpRuntimeNotice[] }) {
  if (notices.length === 0) return null
  return (
    <section aria-labelledby="mcp-notices-heading" className="space-y-2">
      <h3 id="mcp-notices-heading" className="text-[15px] font-semibold text-text-primary">
        Action required
      </h3>
      {notices.map((notice) => (
        <div key={notice.id} className={cn('rounded-lg border px-3 py-2.5', noticeTone(notice))}>
          <div className="flex items-start gap-2">
            <AlertTriangle
              className={cn(
                'mt-0.5 size-3.5 shrink-0',
                notice.severity === 'error' ? 'text-error' : 'text-amber-300',
              )}
            />
            <div>
              <p className="text-[12px] font-medium text-text-primary">{notice.title}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-text-tertiary">{notice.detail}</p>
              {notice.action && (
                <p className="mt-1 text-[11px] text-text-secondary">Next: {notice.action}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </section>
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
    <section aria-labelledby="mcp-sources-heading" className="space-y-3">
      <div>
        <h3 id="mcp-sources-heading" className="text-[15px] font-semibold text-text-primary">
          Configuration sources
        </h3>
        <p className="mt-1 text-[12px] text-text-tertiary">
          OpenWaggle merges standard project MCP configuration with its global and project files.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {sources.map((source) => (
          <Button
            key={source.id}
            variant="unstyled"
            type="button"
            onClick={() => onSelectSource(source.id)}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors',
              selectedSource?.id === source.id
                ? 'border-accent/40 bg-accent/5 text-text-primary'
                : 'border-border bg-bg hover:border-border-light text-text-secondary',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-medium">{source.label}</div>
                <div className="mt-1 truncate text-[11px] text-text-muted">
                  {tildifyPath(source.path)}
                </div>
              </div>
              <StatusPill
                tone={source.parseError ? 'error' : source.exists ? 'success' : 'neutral'}
              >
                {source.parseError ? 'Invalid' : source.exists ? 'Found' : 'Empty'}
              </StatusPill>
            </div>
            <div className="mt-2 text-[11px] text-text-tertiary">
              {source.serverCount} {source.serverCount === 1 ? 'server' : 'servers'}
              {source.ignoredFields.length > 0 &&
                ` · ${source.ignoredFields.length} ignored fields`}
            </div>
          </Button>
        ))}
      </div>
    </section>
  )
}
