import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, PackageOpen, RefreshCw, ShieldAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { usePreferences } from '@/features/settings/hooks'
import { extensionContributionsQueryOptions } from '@/queries/extensions'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { useFullscreen } from '@/shell/useFullscreen'
import type { ExtensionRouteResolution } from '../lib/extension-route-resolution'
import { resolveExtensionRouteContribution } from '../lib/extension-route-resolution'
import { ExtensionFederatedModuleHost } from './ExtensionFederatedModuleHost'

function activeProjectPaths(projectPath: string | null) {
  return projectPath ? [projectPath] : []
}

function projectScopeLabel(projectPaths: readonly string[]) {
  if (projectPaths.length === 0) {
    return 'App scope'
  }

  return projectPaths[0] ?? 'App scope'
}

function ExtensionRouteShell({
  extensionId,
  routeId,
  projectPaths,
  children,
}: {
  readonly extensionId: string
  readonly routeId: string
  readonly projectPaths: readonly string[]
  readonly children: ReactNode
}) {
  const navigate = useNavigate()
  const isFullscreen = useFullscreen()

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg">
      <header
        className={cn(
          'drag-region flex h-12 shrink-0 items-center gap-3 border-b border-border px-4',
          !isFullscreen && 'pl-[80px]',
        )}
      >
        <Button
          className="no-drag inline-flex h-8 items-center gap-2 rounded-md px-2 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
          onClick={() => void navigate({ to: '/settings/$tab', params: { tab: 'extensions' } })}
          type="button"
          variant="unstyled"
        >
          <ArrowLeft className="size-4 shrink-0" />
          <span className="whitespace-nowrap text-[13px]">Extensions</span>
        </Button>
        <nav
          aria-label="Extension route breadcrumbs"
          className="no-drag flex min-w-0 flex-1 items-center gap-2 text-[13px] text-text-muted"
        >
          <PackageOpen className="size-4 shrink-0 text-accent" />
          <span className="min-w-0 truncate">{extensionId}</span>
          <span aria-hidden="true" className="shrink-0 text-text-muted">
            /
          </span>
          <span className="min-w-0 truncate text-text-secondary">{routeId}</span>
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <section className="rounded-xl border border-border bg-bg-secondary/30 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-[18px] font-semibold text-text-primary">Extension route</h1>
                <p className="mt-1 text-[12px] text-text-muted">
                  Controlled namespace mounted at /extensions/&lt;extension-id&gt;/&lt;route-id&gt;.
                  Extension UI is contained and cannot replace the OpenWaggle shell or theme.
                </p>
              </div>
              <span className="rounded-full border border-border/80 bg-bg-tertiary px-2.5 py-1 text-[11px] text-text-tertiary">
                {projectScopeLabel(projectPaths)}
              </span>
            </div>
          </section>
          {children}
        </div>
      </main>
    </div>
  )
}

function ExtensionRouteStatusCard({
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
    <section role="alert" className="rounded-xl border border-border bg-[#111418] p-6">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-accent">{icon}</div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-text-primary">{title}</h2>
          <p className="mt-1 text-[13px] leading-6 text-text-tertiary">{message}</p>
          {action ? <div className="mt-4">{action}</div> : null}
        </div>
      </div>
    </section>
  )
}

function ExtensionRouteLoadingCard() {
  return (
    <output className="rounded-xl border border-border bg-[#111418] p-6">
      <div className="flex items-center gap-3 text-[13px] text-text-tertiary">
        <RefreshCw className="size-4 animate-spin text-accent" />
        Loading extension route registry…
      </div>
    </output>
  )
}

function ExtensionRouteContributionCard({
  resolution,
}: {
  readonly resolution: Extract<ExtensionRouteResolution, { readonly status: 'available' }>
}) {
  const contribution = resolution.contribution
  const entry = contribution.entry

  return (
    <PanelErrorBoundary name={`Extension route: ${entry.title}`}>
      <section className="rounded-xl border border-border bg-[#111418] p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-text-primary">{entry.title}</h2>
            <p className="mt-1 text-[12px] text-text-muted">
              {entry.extensionName} {entry.extensionVersion}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent">
              {contribution.runtime}
            </span>
            <span className="rounded bg-bg-tertiary px-2 py-1 text-[10px] font-medium text-text-tertiary">
              {contribution.execution}
            </span>
            <span className="rounded bg-bg-tertiary px-2 py-1 text-[10px] font-medium text-text-tertiary">
              {entry.scope.label}
            </span>
          </div>
        </div>
        <ExtensionFederatedModuleHost className="min-h-[420px]" entry={entry} />
        <dl className="mt-4 grid gap-3 text-[12px] text-text-tertiary md:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-text-muted">Contribution ID</dt>
            <dd className="truncate text-text-secondary">{entry.contributionId}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-text-muted">Entry</dt>
            <dd className="truncate text-text-secondary">{contribution.entryPath}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-text-muted">Package</dt>
            <dd className="truncate text-text-secondary">{entry.packagePath}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-text-muted">Family</dt>
            <dd className="truncate text-text-secondary">
              {OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.ROUTES}
            </dd>
          </div>
        </dl>
      </section>
    </PanelErrorBoundary>
  )
}

function extensionRouteBody({
  extensionId,
  routeId,
  projectPaths,
  registry,
  loading,
  error,
  onRefresh,
}: {
  readonly extensionId: string
  readonly routeId: string
  readonly projectPaths: readonly string[]
  readonly registry: ExtensionContributionRegistryView | null
  readonly loading: boolean
  readonly error: string | null
  readonly onRefresh: () => void
}): ReactNode {
  if (loading && registry === null) {
    return <ExtensionRouteLoadingCard />
  }

  if (error !== null && registry === null) {
    return (
      <ExtensionRouteStatusCard
        action={
          <Button onClick={onRefresh} size="xs" variant="accent">
            <RefreshCw className="size-3" />
            Retry
          </Button>
        }
        icon={<ShieldAlert className="size-4" />}
        message={error}
        title="Could not load extension route registry"
      />
    )
  }

  if (registry === null) {
    return <ExtensionRouteLoadingCard />
  }

  const resolution = resolveExtensionRouteContribution({
    registry,
    extensionId,
    routeId,
    requestedProjectPaths: projectPaths,
  })

  if (resolution.status === 'available') {
    return <ExtensionRouteContributionCard resolution={resolution} />
  }

  return (
    <ExtensionRouteStatusCard
      icon={<ShieldAlert className="size-4" />}
      message={resolution.message}
      title={resolution.title}
    />
  )
}

export function ExtensionRouteSurfaceContent({
  extensionId,
  routeId,
  projectPaths,
  registry,
  loading,
  error,
  onRefresh,
}: {
  readonly extensionId: string
  readonly routeId: string
  readonly projectPaths: readonly string[]
  readonly registry: ExtensionContributionRegistryView | null
  readonly loading: boolean
  readonly error: string | null
  readonly onRefresh: () => void
}) {
  const body = extensionRouteBody({
    extensionId,
    routeId,
    projectPaths,
    registry,
    loading,
    error,
    onRefresh,
  })

  return (
    <ExtensionRouteShell extensionId={extensionId} projectPaths={projectPaths} routeId={routeId}>
      {body}
    </ExtensionRouteShell>
  )
}

export function ExtensionRouteSurface({
  extensionId,
  routeId,
}: {
  readonly extensionId: string
  readonly routeId: string
}) {
  const { settings } = usePreferences()
  const projectPaths = activeProjectPaths(settings.projectPath)
  const {
    data: registry = null,
    error,
    isPending,
    refetch,
  } = useQuery(extensionContributionsQueryOptions(projectPaths))

  return (
    <ExtensionRouteSurfaceContent
      error={error?.message ?? null}
      extensionId={extensionId}
      loading={isPending}
      onRefresh={() => void refetch()}
      projectPaths={projectPaths}
      registry={registry}
      routeId={routeId}
    />
  )
}
