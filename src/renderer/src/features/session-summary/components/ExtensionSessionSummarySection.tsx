import { match } from '@diegogbrisa/ts-match'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
  ExtensionSessionSummaryRowView,
  ExtensionSessionSummaryView,
} from '@shared/types/extensions'
import type { SessionResource } from '@shared/types/session-resource'
import { AlertCircle, LoaderCircle, Radio } from 'lucide-react'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { SessionSummaryRow, SessionSummarySection } from './SessionSummaryPrimitives'
import { matchingSessionSummaryAction } from './session-summary-extension-actions'

function expansionStorageKey(input: {
  readonly contribution: ExtensionContributionRegistryEntry
  readonly sessionId: string
}) {
  return [
    'openwaggle',
    'session-summary',
    input.sessionId,
    'extension',
    input.contribution.packagePath,
    input.contribution.contentHash,
    input.contribution.contributionId,
  ].join(':')
}

function storedExpansion(storageKey: string) {
  try {
    const stored = localStorage.getItem(storageKey)
    return stored === null ? null : stored === 'true'
  } catch {
    return null
  }
}

function storeExpansion(storageKey: string, expanded: boolean) {
  try {
    localStorage.setItem(storageKey, String(expanded))
  } catch {
    // The disclosure remains usable when durable renderer storage is unavailable.
  }
}

function rowValue(row: ExtensionSessionSummaryRowView): ReactNode {
  if (!row.value && !row.badge && row.count === undefined) return undefined
  return (
    <>
      {row.value ? <span className="truncate text-xs text-text-primary">{row.value}</span> : null}
      {row.badge ? (
        <span className="rounded-full bg-bg-tertiary px-1.5 py-0.5 text-xs text-text-secondary">
          {row.badge}
        </span>
      ) : null}
      {row.count !== undefined ? (
        <span className="font-mono text-xs tabular-nums text-text-tertiary">{row.count}</span>
      ) : null}
    </>
  )
}

function stateView(state: ExtensionSessionSummaryView['state']): ReactNode {
  if (state === undefined) return null
  return match(state)
    .with({ status: 'ready' }, () => null)
    .with({ status: 'loading' }, ({ message }) => (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-7 items-center gap-2 px-1.5 text-xs text-text-tertiary"
      >
        <LoaderCircle
          aria-hidden="true"
          className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
        />
        <span className="min-w-0 truncate">{message ?? 'Loading extension data'}</span>
      </div>
    ))
    .with({ status: 'live' }, ({ message }) => (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-7 items-center gap-2 px-1.5 text-xs text-text-secondary"
      >
        <Radio aria-hidden="true" className="size-3.5 shrink-0 text-progress" />
        <span className="min-w-0 truncate">{message ?? 'Live'}</span>
      </div>
    ))
    .with({ status: 'failure' }, ({ message }) => (
      <div role="alert" className="flex min-h-7 items-center gap-2 px-1.5 text-xs text-error-text">
        <AlertCircle aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 break-words">{message}</span>
      </div>
    ))
    .exhaustive()
}

export function ExtensionSessionSummarySection({
  contribution,
  sessionId,
  registry,
  resources,
  onActivate,
}: {
  readonly contribution: ExtensionContributionRegistryEntry
  readonly sessionId: string
  readonly registry: ExtensionContributionRegistryView
  readonly resources: readonly SessionResource[]
  readonly onActivate: (row: ExtensionSessionSummaryRowView) => void
}) {
  const sectionId = useId()
  const summary = contribution.sessionSummary
  const storageKey = expansionStorageKey({ contribution, sessionId })
  const [expanded, setExpanded] = useState(
    () => storedExpansion(storageKey) ?? summary?.disclosure?.defaultExpanded ?? true,
  )
  const collapsible = summary?.disclosure?.collapsible ?? true
  const autoCollapseAfterMs = summary?.disclosure?.autoCollapseAfterMs
  const resolvedExpanded = collapsible ? expanded : true

  useEffect(() => {
    if (!collapsible || !resolvedExpanded || autoCollapseAfterMs === undefined) return
    const timeout = window.setTimeout(() => {
      setExpanded(false)
      storeExpansion(storageKey, false)
    }, autoCollapseAfterMs)
    return () => window.clearTimeout(timeout)
  }, [autoCollapseAfterMs, collapsible, resolvedExpanded, storageKey])

  if (!summary) return null
  const content = (
    <div className="space-y-0.5">
      {stateView(summary.state)}
      {summary.rows.map((row) => {
        const actionable =
          Boolean(row.resourceId && resources.some((resource) => resource.id === row.resourceId)) ||
          matchingSessionSummaryAction({ registry, section: contribution, row }) !== null
        return (
          <SessionSummaryRow
            key={row.id}
            label={row.label}
            value={rowValue(row)}
            ariaLabel={actionable ? row.label : undefined}
            onClick={actionable ? () => onActivate(row) : undefined}
          />
        )
      })}
    </div>
  )

  if (!collapsible) {
    const titleId = `session-summary-extension-title-${sectionId}`
    return (
      <section className="border-t border-border" aria-labelledby={titleId}>
        <div className="sticky top-0 z-10 flex h-10 items-center gap-2 bg-bg-secondary/95 px-3 backdrop-blur">
          <h3
            id={titleId}
            className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary"
          >
            {contribution.title}
          </h3>
          {summary.rows.length > 0 ? (
            <span className="shrink-0 text-xs text-text-tertiary">{summary.rows.length}</span>
          ) : null}
        </div>
        <div className="space-y-1 px-2 pb-2">{content}</div>
      </section>
    )
  }

  return (
    <SessionSummarySection
      id={sectionId}
      title={contribution.title}
      count={summary.rows.length > 0 ? summary.rows.length : undefined}
      expanded={resolvedExpanded}
      onExpandedChange={(nextExpanded) => {
        setExpanded(nextExpanded)
        storeExpansion(storageKey, nextExpanded)
      }}
    >
      {content}
    </SessionSummarySection>
  )
}
