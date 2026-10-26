import { SessionId } from '@shared/types/brand'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ChessQueen, Pickaxe } from 'lucide-react'
import { useSessionStatusStore } from '@/features/sessions/state'
import type { HiveNextActorGroup } from '@/queries/session-hive-next-actor'
import { sessionHiveRelationsQueryOptions } from '@/queries/session-hive-relations'
import { showRightPanelSurface } from '@/shared/lib/right-panel-surfaces'
import { Button } from '@/shared/ui/Button'
import { hiveSummaryModel } from '../model/session-hive-summary'
import { SessionSummaryFacts, SessionSummaryLinkSection } from './SessionSummaryPrimitives'

type HiveSummary = NonNullable<ReturnType<typeof hiveSummaryModel>>

/**
 * Each group's words and colour, loudest first. They are the Hive panel's groups by who acts next
 * (ADR 0059), so the row and the panel describe a Worker the same way. Only Needs you takes the
 * attention colour; a Worker waiting for this Session needs nothing from the person.
 */
const COUNT_SEGMENTS: readonly {
  readonly group: HiveNextActorGroup
  readonly text: (count: string, one: boolean, title: string) => string
  readonly className: string
}[] = [
  {
    group: 'needs-you',
    text: (count, one) => `${count} ${one ? 'needs' : 'need'} you`,
    className: 'text-warning',
  },
  {
    group: 'waiting',
    text: (count, _one, title) => `${count} waiting for ${title}`,
    className: 'text-text-secondary',
  },
  { group: 'working', text: (count) => `${count} working`, className: 'text-text-secondary' },
  { group: 'closed', text: (count) => `${count} closed`, className: 'text-text-tertiary' },
]

/** "3 direct Workers", "1 needs you", "2 waiting for Queen": the scope, then each group. */
function hiveCountItems(model: HiveSummary) {
  if (model.directCount === 0) return []
  const suffix = model.partial ? '+' : ''
  const scope = {
    key: 'direct',
    text: `${String(model.directCount)} direct ${model.directCount === 1 ? 'Worker' : 'Workers'}`,
  }
  const groups = COUNT_SEGMENTS.flatMap((segment) => {
    const count = model.counts[segment.group]
    if (count === 0) return []
    return [
      {
        key: segment.group,
        text: segment.text(`${String(count)}${suffix}`, count === 1 && !model.partial, model.title),
        className: segment.className,
      },
    ]
  })
  return [scope, ...groups]
}

const OPEN_HIVE_PANEL = 'Open Hive panel'

/**
 * The Session Hub's Hive section: one summary row (ADR 0051).
 *
 * The Hub cannot be shown beside the Right panel, so it no longer lists Workers — a second list
 * would vanish the moment the panel opened and could only drift from it. The row reports the
 * Hive's shape, and the whole row opens the Hive panel, which is the only place Workers are
 * listed (#382).
 */
export function HiveSummarySection({ sessionId }: { readonly sessionId: string }) {
  const query = useInfiniteQuery(sessionHiveRelationsQueryOptions(SessionId(sessionId)))
  const statuses = useSessionStatusStore((state) => state.statuses)
  const model = hiveSummaryModel(query.data?.pages, (id) => statuses.get(SessionId(id)))

  if (!model)
    return query.isError ? (
      <section aria-label="Hive" className="border-t border-border px-3 py-2 first:border-t-0">
        <p role="alert" className="text-sm text-text-secondary">
          Unable to load this session's Hive.
        </p>
        <Button variant="unstyled" onClick={() => void query.refetch()}>
          Retry Hive
        </Button>
      </section>
    ) : null

  const Icon = model.lineage.role === 'queen' ? ChessQueen : Pickaxe
  // A Worker names its parent in the words every Hive surface uses (#377).
  const parentTitle = model.lineage.role === 'worker' ? model.lineage.parentTitle : undefined
  const counts = hiveCountItems(model)
  const accessibleName = [
    OPEN_HIVE_PANEL,
    ...(parentTitle ? [`spawned by ${parentTitle}`] : []),
    ...counts.map((item) => item.text),
  ].join(', ')

  return (
    <SessionSummaryLinkSection
      label="Hive"
      icon={<Icon className="size-3.5 text-accent" />}
      title="Hive"
      details={
        <>
          {parentTitle ? (
            <span className="truncate text-xs text-text-tertiary">Spawned by {parentTitle}</span>
          ) : null}
          <SessionSummaryFacts items={counts} />
        </>
      }
      // Historical (pre-Spawn) Hives are not Spawn lineage, so the Hive panel cannot list them.
      target={
        model.lineage.historical === true
          ? undefined
          : {
              label: OPEN_HIVE_PANEL,
              accessibleName,
              onOpen: () => showRightPanelSurface('hive'),
            }
      }
    />
  )
}
