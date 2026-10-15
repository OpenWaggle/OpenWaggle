import type {
  UsageCostBucket,
  UsageCostQuery,
  UsageCostSessionRow,
  UsageCostView,
} from '@shared/types/usage-cost'
import { ArrowLeft, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { useFullscreen } from '@/shell/useFullscreen'
import type { UsageCostDrillDown } from '../hooks/use-usage-cost-view'
import { formatTimestampLabel } from '../lib/usage-cost-format'
import { UsageCostBreakdownList } from './UsageCostBreakdownList'
import { UsageCostDailyChart } from './UsageCostDailyChart'
import { UsageCostFilterBar } from './UsageCostFilterBar'
import { UsageCostSessionsPanel } from './UsageCostSessionsPanel'
import { UsageCostSummaryCards } from './UsageCostSummaryCards'

export interface UsageCostPageState {
  readonly query: UsageCostQuery
  readonly drillDown: UsageCostDrillDown
  readonly isLoading: boolean
  readonly isError: boolean
  readonly errorMessage: string | null
  readonly sessionsLoading: boolean
  readonly view: UsageCostView | null
  readonly sessions: readonly UsageCostSessionRow[]
  readonly refresh: () => void
  readonly setRange: (preset: UsageCostQuery['preset']) => void
  readonly setOrigin: (origin: UsageCostQuery['origin']) => void
  readonly toggleDay: (day: string) => void
  readonly toggleModel: (model: { provider: string; modelId: string }) => void
  readonly toggleProject: (project: { projectPath: string | null; label: string }) => void
  readonly clearDrillDown: () => void
}

interface UsageCostPageProps {
  readonly state: UsageCostPageState
  /** Leaves the full-page view; the shell hides the sidebar and header on this route. */
  readonly onBack: () => void
}

function hasActiveDrillDown(drillDown: UsageCostDrillDown) {
  return (
    drillDown.day !== undefined ||
    drillDown.provider !== undefined ||
    drillDown.projectPath !== undefined
  )
}

function originLabel(origin: UsageCostQuery['origin']) {
  if (origin === 'openwaggle') return 'OpenWaggle sessions'
  if (origin === 'other-pi-clients') return 'pi CLI & other clients'
  return 'all Pi sessions'
}

function formatTierSummary(totals: UsageCostBucket) {
  const parts: string[] = []
  if (totals.recordedCostUsd > 0) parts.push('costs recorded in session history')
  if (totals.estimatedCostUsd > 0) parts.push('costs estimated from model rates')
  if (totals.unpricedTokens > 0) parts.push('unpriced tokens excluded from cost')
  return parts.length > 0 ? parts.join(', ') : 'no priced tokens yet'
}

export function UsageCostPage({ state, onBack }: UsageCostPageProps) {
  return (
    <div className="flex size-full flex-col bg-bg">
      <UsageCostTopBar onBack={onBack} />
      <div className="min-h-0 flex-1">
        <UsageCostBody state={state} />
      </div>
    </div>
  )
}

/**
 * Mirrors the Settings top bar: window drag region, traffic-light inset, and a way back.
 * The page heading below names the view, so the bar carries only the back action.
 */
function UsageCostTopBar({ onBack }: { readonly onBack: () => void }) {
  const isFullscreen = useFullscreen()
  return (
    <div
      className={cn(
        'drag-region flex h-12 shrink-0 items-center gap-3 border-b border-border px-4',
        !isFullscreen && 'pl-20',
      )}
    >
      <Button
        variant="unstyled"
        onClick={onBack}
        className="no-drag flex items-center gap-2 rounded-md px-2 py-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
      >
        <ArrowLeft className="size-4" />
        <span className="text-xs">Back to app</span>
      </Button>
    </div>
  )
}

function CenteredMessage({ children }: { readonly children: ReactNode }) {
  return <div className="flex size-full items-center justify-center bg-bg p-8">{children}</div>
}

function UsageCostBody({ state }: { readonly state: UsageCostPageState }) {
  const { view } = state

  if (state.isError) {
    return (
      <CenteredMessage>
        <div className="max-w-sm text-center">
          <h1 className="text-base font-semibold text-text-primary">Usage & Cost is unavailable</h1>
          <p className="mt-2 text-sm text-text-tertiary">
            {state.errorMessage ?? 'The scan could not be read.'}
          </p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={state.refresh}>
            Try again
          </Button>
        </div>
      </CenteredMessage>
    )
  }

  if (!view) {
    return (
      <CenteredMessage>
        <p className="text-sm text-text-tertiary" aria-live="polite">
          Scanning Pi sessions…
        </p>
      </CenteredMessage>
    )
  }

  return (
    <div className="@container/usage size-full overflow-y-auto bg-bg">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        <UsageCostHeader state={state} view={view} />
        <UsageCostFilterBar
          query={state.query}
          onRange={state.setRange}
          onOrigin={state.setOrigin}
        />
        <UsageCostSummaryCards
          totals={view.totals}
          unpricedShare={view.unpricedShare}
          sessionCount={view.sessionCount}
        />
        {view.totals.tokens.total === 0 ? (
          <UsageCostEmptyState query={state.query} />
        ) : (
          <UsageCostContent state={state} view={view} />
        )}
        <footer className="pb-4 text-xs text-text-tertiary">
          Updated {formatTimestampLabel(view.generatedAtMs)} · {formatTierSummary(view.totals)} ·
          Origin: {originLabel(state.query.origin)}.
        </footer>
      </div>
    </div>
  )
}

function UsageCostHeader({
  state,
  view,
}: {
  readonly state: UsageCostPageState
  readonly view: UsageCostView
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Usage & Cost</h1>
        <p className="mt-1 max-w-xl text-sm text-text-tertiary">
          Token spending from Pi sessions on this machine. Costs are estimates from model rates, not
          your bill.
        </p>
      </div>
      <div className="flex items-center gap-3">
        {view.scannedFiles > 0 ? (
          <span className="text-xs text-text-tertiary">
            {view.scannedFiles - view.scannedFilesCached} scanned · {view.scannedFilesCached} cached
            · {view.scanDurationMs} ms
          </span>
        ) : null}
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Refresh usage"
          onClick={state.refresh}
        >
          <RotateCw className="size-3.5" />
        </Button>
      </div>
    </header>
  )
}

function UsageCostContent({
  state,
  view,
}: {
  readonly state: UsageCostPageState
  readonly view: UsageCostView
}) {
  return (
    <>
      <section aria-label="Daily spending" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-text-secondary">Daily spending</h2>
        <UsageCostDailyChart
          days={view.days}
          totals={view.totals}
          activeDay={state.drillDown.day}
          onSelectDay={state.toggleDay}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 @min-[900px]/usage:grid-cols-2">
        <section aria-label="By model" className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-text-secondary">By model</h2>
          <UsageCostBreakdownList
            rows={view.models.map((model) => ({
              key: `${model.provider}/${model.modelId}`,
              label: model.modelId,
              detail: model.provider,
              bucket: model,
              totals: view.totals,
              isActive:
                state.drillDown.provider === model.provider &&
                state.drillDown.modelId === model.modelId,
              onSelect: () => state.toggleModel(model),
            }))}
          />
        </section>
        <section aria-label="By project" className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-text-secondary">By project</h2>
          <UsageCostBreakdownList
            rows={view.projects.map((project) => ({
              key: project.projectPath ?? 'unknown',
              label: project.label,
              detail: project.detail,
              bucket: project,
              totals: view.totals,
              isActive: state.drillDown.projectPath === project.projectPath,
              onSelect: () => state.toggleProject(project),
            }))}
          />
        </section>
      </div>

      <UsageCostSessionsPanel
        sessions={state.sessions}
        isLoading={state.sessionsLoading}
        drillDown={state.drillDown}
        hasActiveDrillDown={hasActiveDrillDown(state.drillDown)}
        onClearDrillDown={state.clearDrillDown}
      />
    </>
  )
}

function UsageCostEmptyState({ query }: { readonly query: UsageCostQuery }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-bg-secondary px-6 py-12 text-center">
      <p className="text-sm font-medium text-text-primary">No spending in this window</p>
      <p className="mt-2 max-w-md text-sm text-text-tertiary">
        Usage &amp; Cost counts every Pi session on this machine — OpenWaggle windows and pi in a
        terminal. Run an agent, then come back: the{' '}
        {query.preset === 'all' ? 'all-time' : query.preset} window will fill in.
      </p>
    </div>
  )
}
