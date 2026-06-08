import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { JsonValue } from '@shared/types/json'
import { MessageSquare, RefreshCw, ShieldAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/shared/ui/Button'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import type {
  ExtensionDialogResolution,
  ExtensionDialogTarget,
} from '../lib/extension-dialog-resolution'
import { resolveExtensionDialogContribution } from '../lib/extension-dialog-resolution'
import { ExtensionFederatedModuleHost } from './ExtensionFederatedModuleHost'

function ExtensionDialogShell({
  title,
  children,
  onClose,
}: {
  readonly title: string
  readonly children: ReactNode
  readonly onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <section
        aria-label={title}
        aria-modal="true"
        className="flex max-h-[calc(100vh-32px)] min-h-[420px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-bg shadow-2xl"
        role="dialog"
      >
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-bg-secondary/90 px-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent/10 text-accent">
            <MessageSquare className="size-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium tracking-wide text-text-muted uppercase">
              Extension dialog
            </p>
            <h2 className="truncate text-[13px] font-semibold text-text-primary">{title}</h2>
          </div>
          <Button
            aria-label="Close extension dialog"
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
    </div>
  )
}

function ExtensionDialogStatusCard({
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

function ExtensionDialogLoadingCard() {
  return (
    <output className="rounded-xl border border-border bg-[#111418] p-4">
      <div className="flex items-center gap-3 text-[12px] text-text-tertiary">
        <RefreshCw className="size-4 animate-spin text-accent" />
        Loading extension dialog registry...
      </div>
    </output>
  )
}

function ExtensionDialogContribution({
  resolution,
  surfacePayload,
}: {
  readonly resolution: Extract<ExtensionDialogResolution, { readonly status: 'available' }>
  readonly surfacePayload?: JsonValue
}) {
  const entry = resolution.contribution.entry

  return (
    <PanelErrorBoundary className="flex min-h-0 flex-1" name={`Extension dialog: ${entry.title}`}>
      <ExtensionFederatedModuleHost
        chrome="bare"
        entry={entry}
        fill
        surfacePayload={surfacePayload}
      />
    </PanelErrorBoundary>
  )
}

function extensionDialogBody({
  target,
  projectPaths,
  registry,
  loading,
  error,
  onRefresh,
  surfacePayload,
}: {
  readonly target: ExtensionDialogTarget
  readonly projectPaths: readonly string[]
  readonly registry: ExtensionContributionRegistryView | null
  readonly loading: boolean
  readonly error: string | null
  readonly onRefresh: () => void
  readonly surfacePayload?: JsonValue
}): ReactNode {
  if (loading && registry === null) {
    return <ExtensionDialogLoadingCard />
  }

  if (error !== null && registry === null) {
    return (
      <ExtensionDialogStatusCard
        action={
          <Button onClick={onRefresh} size="xs" variant="accent">
            <RefreshCw className="size-3" />
            Retry
          </Button>
        }
        icon={<ShieldAlert className="size-4" />}
        message={error}
        title="Could not load extension dialog registry"
      />
    )
  }

  if (registry === null) {
    return <ExtensionDialogLoadingCard />
  }

  const resolution = resolveExtensionDialogContribution({
    registry,
    target,
    requestedProjectPaths: projectPaths,
  })

  if (resolution.status === 'available') {
    return <ExtensionDialogContribution resolution={resolution} surfacePayload={surfacePayload} />
  }

  return (
    <ExtensionDialogStatusCard
      icon={<ShieldAlert className="size-4" />}
      message={resolution.message}
      title={resolution.title}
    />
  )
}

function extensionDialogTitle({
  registry,
  target,
  projectPaths,
}: {
  readonly registry: ExtensionContributionRegistryView | null
  readonly target: ExtensionDialogTarget
  readonly projectPaths: readonly string[]
}) {
  if (registry === null) {
    return target.dialogId
  }

  const resolution = resolveExtensionDialogContribution({
    registry,
    target,
    requestedProjectPaths: projectPaths,
  })

  return resolution.status === 'available' ? resolution.contribution.entry.title : target.dialogId
}

export function ExtensionDialogSurfaceContent({
  target,
  projectPaths,
  registry,
  loading,
  error,
  onRefresh,
  onClose,
  surfacePayload,
}: {
  readonly target: ExtensionDialogTarget
  readonly projectPaths: readonly string[]
  readonly registry: ExtensionContributionRegistryView | null
  readonly loading: boolean
  readonly error: string | null
  readonly onRefresh: () => void
  readonly onClose: () => void
  readonly surfacePayload?: JsonValue
}) {
  const title = extensionDialogTitle({ registry, target, projectPaths })
  const body = extensionDialogBody({
    target,
    projectPaths,
    registry,
    loading,
    error,
    onRefresh,
    surfacePayload,
  })

  return (
    <ExtensionDialogShell onClose={onClose} title={title}>
      {body}
    </ExtensionDialogShell>
  )
}

export function ExtensionDialogSurface({
  target,
  projectPaths,
  registry,
  loading,
  error,
  onRefresh,
  onClose,
  surfacePayload,
}: {
  readonly target: ExtensionDialogTarget
  readonly projectPaths: readonly string[]
  readonly registry: ExtensionContributionRegistryView | null
  readonly loading: boolean
  readonly error: string | null
  readonly onRefresh: () => void
  readonly onClose: () => void
  readonly surfacePayload?: JsonValue
}) {
  return (
    <ExtensionDialogSurfaceContent
      error={error}
      loading={loading}
      onClose={onClose}
      onRefresh={onRefresh}
      projectPaths={projectPaths}
      registry={registry}
      surfacePayload={surfacePayload}
      target={target}
    />
  )
}
