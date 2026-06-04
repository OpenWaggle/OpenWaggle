import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import { PanelRight, RefreshCw, ShieldAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/shared/ui/Button'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import type {
  ExtensionSidePanelResolution,
  ExtensionSidePanelTarget,
} from '../lib/extension-side-panel-resolution'
import { resolveExtensionSidePanelContribution } from '../lib/extension-side-panel-resolution'
import { ExtensionFederatedModuleHost } from './ExtensionFederatedModuleHost'

function projectScopeLabel(projectPaths: readonly string[]) {
  if (projectPaths.length === 0) {
    return 'App scope'
  }

  return projectPaths[0] ?? 'App scope'
}

function ExtensionSidePanelShell({
  extensionId,
  scopeLabel,
  title,
  children,
  onClose,
}: {
  readonly extensionId: string
  readonly scopeLabel: string
  readonly title: string
  readonly children: ReactNode
  readonly onClose: () => void
}) {
  return (
    <section aria-label="Extension side panel" className="flex size-full flex-col bg-diff-bg">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-bg-secondary/80 px-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent/10 text-accent">
          <PanelRight className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium tracking-wide text-text-muted uppercase">
            Extension side panel
          </p>
          <h2 className="truncate text-[13px] font-semibold text-text-primary">{title}</h2>
        </div>
        <span className="hidden max-w-28 truncate rounded-full border border-border/80 bg-bg-tertiary px-2 py-1 text-[10px] text-text-tertiary sm:inline">
          {scopeLabel}
        </span>
        <Button
          aria-label="Close extension side panel"
          className="size-7 rounded-md p-0 text-text-tertiary hover:bg-bg-hover hover:text-text-secondary"
          onClick={onClose}
          type="button"
          variant="unstyled"
        >
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-3 min-w-0 rounded-lg border border-border/70 bg-bg-secondary/40 px-3 py-2 text-[11px] text-text-tertiary">
          <span className="text-text-muted">Extension</span>{' '}
          <span className="text-text-secondary">{extensionId}</span>
        </div>
        {children}
      </div>
    </section>
  )
}

function ExtensionSidePanelStatusCard({
  icon,
  title,
  message,
  action,
}: {
  readonly icon: ReactNode
  readonly title: string
  readonly message: string
  readonly action?: ReactNode
}) {
  return (
    <section role="alert" className="rounded-xl border border-border bg-[#111418] p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-accent">{icon}</div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-text-primary">{title}</h3>
          <p className="mt-1 text-[12px] leading-5 text-text-tertiary">{message}</p>
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </section>
  )
}

function ExtensionSidePanelLoadingCard() {
  return (
    <output className="rounded-xl border border-border bg-[#111418] p-4">
      <div className="flex items-center gap-3 text-[12px] text-text-tertiary">
        <RefreshCw className="size-4 animate-spin text-accent" />
        Loading extension side panel registry…
      </div>
    </output>
  )
}

function ExtensionSidePanelContribution({
  resolution,
}: {
  readonly resolution: Extract<ExtensionSidePanelResolution, { readonly status: 'available' }>
}) {
  const contribution = resolution.contribution
  const entry = contribution.entry

  return (
    <PanelErrorBoundary name={`Extension side panel: ${entry.title}`} className="min-h-0">
      <section className="rounded-xl border border-border bg-[#111418] p-3">
        <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[14px] font-semibold text-text-primary">{entry.title}</h3>
            <p className="mt-1 truncate text-[11px] text-text-muted">
              {entry.extensionName} {entry.extensionVersion}
            </p>
          </div>
          <span className="shrink-0 rounded bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent">
            {contribution.runtime}
          </span>
        </div>
        <ExtensionFederatedModuleHost className="min-h-[280px]" entry={entry} />
        <dl className="mt-3 grid gap-2 text-[11px] text-text-tertiary">
          <div className="min-w-0">
            <dt className="text-text-muted">Contribution ID</dt>
            <dd className="truncate text-text-secondary">{entry.contributionId}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-text-muted">Entry</dt>
            <dd className="truncate text-text-secondary">{contribution.entryPath}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-text-muted">Family</dt>
            <dd className="truncate text-text-secondary">
              {OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS}
            </dd>
          </div>
        </dl>
      </section>
    </PanelErrorBoundary>
  )
}

function extensionSidePanelBody({
  target,
  projectPaths,
  registry,
  loading,
  error,
  onRefresh,
}: {
  readonly target: ExtensionSidePanelTarget
  readonly projectPaths: readonly string[]
  readonly registry: ExtensionContributionRegistryView | null
  readonly loading: boolean
  readonly error: string | null
  readonly onRefresh: () => void
}): ReactNode {
  if (loading && registry === null) {
    return <ExtensionSidePanelLoadingCard />
  }

  if (error !== null && registry === null) {
    return (
      <ExtensionSidePanelStatusCard
        action={
          <Button onClick={onRefresh} size="xs" variant="accent">
            <RefreshCw className="size-3" />
            Retry
          </Button>
        }
        icon={<ShieldAlert className="size-4" />}
        message={error}
        title="Could not load extension side panel registry"
      />
    )
  }

  if (registry === null) {
    return <ExtensionSidePanelLoadingCard />
  }

  const resolution = resolveExtensionSidePanelContribution({
    registry,
    target,
    requestedProjectPaths: projectPaths,
  })

  if (resolution.status === 'available') {
    return <ExtensionSidePanelContribution resolution={resolution} />
  }

  return (
    <ExtensionSidePanelStatusCard
      icon={<ShieldAlert className="size-4" />}
      message={resolution.message}
      title={resolution.title}
    />
  )
}

function extensionSidePanelTitle({
  registry,
  target,
  projectPaths,
}: {
  readonly registry: ExtensionContributionRegistryView | null
  readonly target: ExtensionSidePanelTarget
  readonly projectPaths: readonly string[]
}) {
  if (registry === null) {
    return target.sidePanelId
  }

  const resolution = resolveExtensionSidePanelContribution({
    registry,
    target,
    requestedProjectPaths: projectPaths,
  })

  return resolution.status === 'available'
    ? resolution.contribution.entry.title
    : target.sidePanelId
}

export function ExtensionSidePanelSurfaceContent({
  target,
  projectPaths,
  registry,
  loading,
  error,
  onRefresh,
  onClose,
}: {
  readonly target: ExtensionSidePanelTarget
  readonly projectPaths: readonly string[]
  readonly registry: ExtensionContributionRegistryView | null
  readonly loading: boolean
  readonly error: string | null
  readonly onRefresh: () => void
  readonly onClose: () => void
}) {
  const title = extensionSidePanelTitle({ registry, target, projectPaths })
  const body = extensionSidePanelBody({
    target,
    projectPaths,
    registry,
    loading,
    error,
    onRefresh,
  })

  return (
    <ExtensionSidePanelShell
      extensionId={target.extensionId}
      onClose={onClose}
      scopeLabel={projectScopeLabel(projectPaths)}
      title={title}
    >
      {body}
    </ExtensionSidePanelShell>
  )
}

export function ExtensionSidePanelSurface({
  target,
  projectPaths,
  registry,
  loading,
  error,
  onRefresh,
  onClose,
}: {
  readonly target: ExtensionSidePanelTarget
  readonly projectPaths: readonly string[]
  readonly registry: ExtensionContributionRegistryView | null
  readonly loading: boolean
  readonly error: string | null
  readonly onRefresh: () => void
  readonly onClose: () => void
}) {
  return (
    <ExtensionSidePanelSurfaceContent
      error={error}
      loading={loading}
      onClose={onClose}
      onRefresh={onRefresh}
      projectPaths={projectPaths}
      registry={registry}
      target={target}
    />
  )
}
