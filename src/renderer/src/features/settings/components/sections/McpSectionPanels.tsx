import type {
  McpConfigSourceId,
  McpConfigSourceSummary,
  McpRuntimeNotice,
  McpScope,
  McpScopeResolution,
  McpScopeState,
  McpSettingsView,
} from '@shared/types/mcp'
import { AlertTriangle, Network, RotateCw } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
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

const SCOPE_OPTIONS: Record<McpScope, readonly McpScopeState[]> = {
  global: ['on', 'off'],
  project: ['inherit', 'on', 'off'],
  session: ['inherit', 'on', 'off'],
}

function currentScopeState(resolution: McpScopeResolution, scope: McpScope) {
  return scope === 'global' ? resolution.global : resolution[scope]
}

function ScopeControl({
  scope,
  resolution,
  available,
  busy,
  onChange,
}: {
  readonly scope: McpScope
  readonly resolution: McpScopeResolution
  readonly available: boolean
  readonly busy: boolean
  readonly onChange: (scope: McpScope, state: McpScopeState) => void
}) {
  const current = currentScopeState(resolution, scope)
  return (
    <div className={cn('min-w-0 flex-1 px-4 py-3', !available && 'opacity-50')}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-text-primary">{titleCase(scope)}</span>
        {resolution.source === scope && <StatusPill tone="accent">Effective source</StatusPill>}
      </div>
      <div className="inline-flex rounded-md border border-border bg-bg p-0.5">
        {SCOPE_OPTIONS[scope].map((option) => (
          <Button
            key={option}
            variant="unstyled"
            type="button"
            aria-pressed={current === option}
            aria-label={`Set ${titleCase(scope)} scope to ${titleCase(option)}`}
            disabled={!available || busy}
            onClick={() => onChange(scope, option)}
            className={cn(
              'rounded px-2.5 py-1 text-[11px] transition-colors',
              current === option
                ? 'bg-bg-hover text-text-primary'
                : 'text-text-muted hover:text-text-secondary',
            )}
          >
            {titleCase(option)}
          </Button>
        ))}
      </div>
      {!available && (
        <p className="mt-2 text-[10px] text-text-muted">
          {scope === 'project' ? 'Open a project to configure.' : 'Open a session to configure.'}
        </p>
      )}
    </div>
  )
}

export function McpScopeRail({
  view,
  busy,
  onChange,
}: {
  readonly view: McpSettingsView | null
  readonly busy: boolean
  readonly onChange: (scope: McpScope, state: McpScopeState) => void
}) {
  if (!view) return null
  const { desired } = view.integration
  return (
    <section aria-labelledby="mcp-scope-heading" className="space-y-3">
      <div>
        <h3 id="mcp-scope-heading" className="text-[15px] font-semibold text-text-primary">
          Activation scope
        </h3>
        <p className="mt-1 text-[12px] text-text-tertiary">
          Session overrides project; project overrides global. Inherit leaves the decision to the
          wider scope.
        </p>
      </div>
      <div className="divide-x divide-border overflow-hidden rounded-lg border border-border bg-[#111418]">
        <div className="flex">
          {(['global', 'project', 'session'] as const).map((scope) => (
            <ScopeControl
              key={scope}
              scope={scope}
              resolution={desired}
              available={
                scope === 'global' || (scope === 'project' ? !!view.projectPath : !!view.sessionId)
              }
              busy={busy}
              onChange={onChange}
            />
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[11px]">
          <span className="text-text-tertiary">
            Desired: <strong className="font-medium text-text-primary">{desired.effective}</strong>
            {' · '}Applied:{' '}
            <strong className="font-medium text-text-primary">{view.integration.applied}</strong>
          </span>
          {view.integration.applyState === 'pending' && (
            <StatusPill tone="warning">Applies at next safe turn boundary</StatusPill>
          )}
        </div>
      </div>
    </section>
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
                <div className="mt-1 truncate text-[11px] text-text-muted">{source.path}</div>
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
