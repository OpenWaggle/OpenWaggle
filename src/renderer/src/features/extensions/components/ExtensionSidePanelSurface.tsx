import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { JsonValue } from '@shared/types/json'
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

function ExtensionSidePanelShell({
  title,
  children,
  onClose,
}: {
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">{children}</div>
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
  onSurfaceAction,
  resolution,
  surfacePayload,
}: {
  readonly onSurfaceAction?: (actionId: string, payload?: JsonValue) => void
  readonly resolution: Extract<ExtensionSidePanelResolution, { readonly status: 'available' }>
  readonly surfacePayload?: JsonValue
}) {
  const entry = resolution.contribution.entry

  return (
    <PanelErrorBoundary
      className="flex min-h-0 flex-1"
      name={`Extension side panel: ${entry.title}`}
    >
      <ExtensionFederatedModuleHost
        chrome="bare"
        entry={entry}
        fill
        onSurfaceAction={onSurfaceAction}
        surfacePayload={surfacePayload}
      />
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
  onSurfaceAction,
  surfacePayload,
}: {
  readonly target: ExtensionSidePanelTarget
  readonly projectPaths: readonly string[]
  readonly registry: ExtensionContributionRegistryView | null
  readonly loading: boolean
  readonly error: string | null
  readonly onRefresh: () => void
  readonly onSurfaceAction?: (actionId: string, payload?: JsonValue) => void
  readonly surfacePayload?: JsonValue
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
    return (
      <ExtensionSidePanelContribution
        onSurfaceAction={onSurfaceAction}
        resolution={resolution}
        surfacePayload={surfacePayload}
      />
    )
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
  onSurfaceAction,
  surfacePayload,
}: {
  readonly target: ExtensionSidePanelTarget
  readonly projectPaths: readonly string[]
  readonly registry: ExtensionContributionRegistryView | null
  readonly loading: boolean
  readonly error: string | null
  readonly onRefresh: () => void
  readonly onClose: () => void
  readonly onSurfaceAction?: (actionId: string, payload?: JsonValue) => void
  readonly surfacePayload?: JsonValue
}) {
  const title = extensionSidePanelTitle({ registry, target, projectPaths })
  const body = extensionSidePanelBody({
    target,
    projectPaths,
    registry,
    loading,
    error,
    onRefresh,
    onSurfaceAction,
    surfacePayload,
  })

  return (
    <ExtensionSidePanelShell onClose={onClose} title={title}>
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
  onSurfaceAction,
  surfacePayload,
}: {
  readonly target: ExtensionSidePanelTarget
  readonly projectPaths: readonly string[]
  readonly registry: ExtensionContributionRegistryView | null
  readonly loading: boolean
  readonly error: string | null
  readonly onRefresh: () => void
  readonly onClose: () => void
  readonly onSurfaceAction?: (actionId: string, payload?: JsonValue) => void
  readonly surfacePayload?: JsonValue
}) {
  const contentProps = {
    error,
    loading,
    onClose,
    onRefresh,
    projectPaths,
    registry,
    target,
    ...(onSurfaceAction ? { onSurfaceAction } : {}),
    ...(surfacePayload !== undefined ? { surfacePayload } : {}),
  }

  return <ExtensionSidePanelSurfaceContent {...contentProps} />
}
