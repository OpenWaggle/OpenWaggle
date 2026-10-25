import { SessionId } from '@shared/types/brand'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ChessQueen, Pickaxe } from 'lucide-react'
import type { HiveDelegationGroup } from '@/queries/session-hive-contract'
import { sessionHiveRelationsQueryOptions } from '@/queries/session-hive-relations'
import { showRightPanelSurface } from '@/shared/lib/right-panel-surfaces'
import { Button } from '@/shared/ui/Button'
import { hiveSummaryModel } from '../model/session-hive-summary'

type HiveSummary = NonNullable<ReturnType<typeof hiveSummaryModel>>

/**
 * Each group's words and colour, loudest first. They are the Hive panel's groups, so the row and
 * the panel describe a Worker the same way (#356).
 */
const COUNT_SEGMENTS: readonly {
  readonly group: HiveDelegationGroup
  readonly text: (count: string, one: boolean) => string
  readonly className: string
}[] = [
  {
    group: 'needs-attention',
    text: (count, one) => `${count} ${one ? 'needs' : 'need'} attention`,
    className: 'text-warning',
  },
  {
    group: 'ready-for-review',
    text: (count) => `${count} ready for review`,
    className: 'text-accent',
  },
  { group: 'active', text: (count) => `${count} active`, className: 'text-text-secondary' },
  { group: 'closed', text: (count) => `${count} closed`, className: 'text-text-tertiary' },
]

/** "3 direct Workers · 3 ready for review": the scope first, then every group that has one. */
function HiveSummaryCounts({ model }: { readonly model: HiveSummary }) {
  const suffix = model.partial ? '+' : ''
  return (
    <span className="text-xs text-text-tertiary">
      {model.directCount} direct {model.directCount === 1 ? 'Worker' : 'Workers'}
      {COUNT_SEGMENTS.map((segment) => {
        const count = model.counts[segment.group]
        if (count === 0) return null
        return (
          <span key={segment.group}>
            {' · '}
            <span className={segment.className}>
              {segment.text(`${String(count)}${suffix}`, count === 1 && !model.partial)}
            </span>
          </span>
        )
      })}
    </span>
  )
}

/**
 * The Session Hub's Hive section: one summary row (ADR 0051).
 *
 * The Hub cannot be shown beside the Right panel, so it no longer lists Workers — a second list
 * would vanish the moment the panel opened and could only drift from it. The row reports the
 * Hive's shape and opens the Hive panel, which is the only place Workers are listed.
 */
export function HiveSummarySection({ sessionId }: { readonly sessionId: string }) {
  const query = useInfiniteQuery(sessionHiveRelationsQueryOptions(SessionId(sessionId)))
  const model = hiveSummaryModel(query.data?.pages)

  if (!model)
    return query.isError ? (
      <section aria-label="Hive" className="border-t border-border px-3 py-2">
        <p role="alert" className="text-sm text-text-secondary">
          Unable to load this session's Hive.
        </p>
        <Button variant="unstyled" onClick={() => void query.refetch()}>
          Retry Hive
        </Button>
      </section>
    ) : null

  const Icon = model.lineage.role === 'queen' ? ChessQueen : Pickaxe

  return (
    <section className="border-t border-border" aria-label="Hive">
      <div className="flex h-10 items-center gap-2 px-3">
        <Icon aria-hidden="true" className="size-3.5 text-accent" />
        <span className="flex-1 text-sm font-medium text-text-primary">Hive</span>
        {model.directCount > 0 ? <HiveSummaryCounts model={model} /> : null}
        {/* Historical (pre-Spawn) Hives are not Spawn lineage, so the Hive panel cannot list them. */}
        {model.lineage.historical === true ? null : (
          <Button
            variant="unstyled"
            className="rounded-md px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
            aria-label="Open in Hive panel"
            onClick={() => showRightPanelSurface('hive')}
          >
            Open in Hive panel
          </Button>
        )}
      </div>
    </section>
  )
}
