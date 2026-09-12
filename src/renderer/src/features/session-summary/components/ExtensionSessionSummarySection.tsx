import { match } from '@diegogbrisa/ts-match'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
  ExtensionSessionSummaryRowView,
  ExtensionSessionSummaryView,
} from '@shared/types/extensions'
import { AlertCircle, LoaderCircle, Radio } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { SessionSummaryRow, SessionSummarySection } from './SessionSummaryPrimitives'
import { resolveSessionSummaryAction } from './session-summary-extension-actions'

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
        aria-hidden="true"
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
        aria-hidden="true"
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

function stateAnnouncement(state: ExtensionSessionSummaryView['state']) {
  if (state?.status === 'loading') return state.message ?? 'Loading extension data'
  if (state?.status === 'live') return state.message ?? 'Live'
  return ''
}

export function ExtensionSessionSummarySection({
  contribution,
  sessionId,
  projectPath,
  registry,
  onActivate,
}: {
  readonly contribution: ExtensionContributionRegistryEntry
  readonly sessionId: string
  readonly projectPath: string | null
  readonly registry: ExtensionContributionRegistryView
  readonly onActivate: (row: ExtensionSessionSummaryRowView) => void
}) {
  const sectionId = useId()
  const summary = contribution.sessionSummary
  const storageKey = expansionStorageKey({ contribution, sessionId })
  const [expanded, setExpanded] = useState(
    () => storedExpansion(storageKey) ?? summary?.disclosure?.defaultExpanded ?? true,
  )
  const sectionRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const collapsible = summary?.disclosure?.collapsible ?? true
  const autoCollapseAfterMs = summary?.disclosure?.autoCollapseAfterMs
  const visuallyEmpty =
    summary?.rows.length === 0 && (summary.state === undefined || summary.state.status === 'ready')

  useEffect(() => {
    if (!collapsible || !expanded || autoCollapseAfterMs === undefined || visuallyEmpty) {
      return
    }
    const timeout = window.setTimeout(() => {
      const activeElement = document.activeElement
      if (
        activeElement instanceof HTMLElement &&
        activeElement !== triggerRef.current &&
        sectionRef.current?.contains(activeElement)
      ) {
        triggerRef.current?.focus()
      }
      setExpanded(false)
      storeExpansion(storageKey, false)
    }, autoCollapseAfterMs)
    return () => window.clearTimeout(timeout)
  }, [autoCollapseAfterMs, collapsible, expanded, storageKey, visuallyEmpty])

  if (!summary) return null
  const announcer = (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {stateAnnouncement(summary.state)}
    </p>
  )
  if (visuallyEmpty) return announcer
  const content = (
    <div className="space-y-0.5">
      {stateView(summary.state)}
      {summary.rows.map((row) => {
        const hasResource = Boolean(row.resourceId)
        const action = hasResource
          ? null
          : resolveSessionSummaryAction({
              registry,
              section: contribution,
              row,
              projectPath,
              sessionId,
            })
        const actionable = hasResource || action !== null
        return (
          <SessionSummaryRow
            key={row.id}
            label={row.label}
            value={rowValue(row)}
            ariaLabel={actionable ? row.label : undefined}
            disabledReason={action?.kind === 'disabled-command' ? action.disabledReason : undefined}
            onClick={actionable ? () => onActivate(row) : undefined}
          />
        )
      })}
    </div>
  )

  if (!collapsible) {
    const titleId = `session-summary-extension-title-${sectionId}`
    return (
      <>
        {announcer}
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
      </>
    )
  }

  return (
    <>
      {announcer}
      <SessionSummarySection
        id={sectionId}
        title={contribution.title}
        count={summary.rows.length > 0 ? summary.rows.length : undefined}
        expanded={expanded}
        sectionRef={sectionRef}
        triggerRef={triggerRef}
        onExpandedChange={(nextExpanded) => {
          setExpanded(nextExpanded)
          storeExpansion(storageKey, nextExpanded)
        }}
      >
        {content}
      </SessionSummarySection>
    </>
  )
}
