import { SessionId } from '@shared/types/brand'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ChessQueen, Pickaxe } from 'lucide-react'
import { sessionHiveRelationsQueryOptions } from '@/queries/session-hive-relations'
import { showRightPanelSurface } from '@/shared/lib/right-panel-surfaces'
import { Button } from '@/shared/ui/Button'
import { hiveSummaryModel } from '../model/session-hive-summary'

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
        {model.totalCount > 0 ? (
          <span className={model.attention ? 'text-xs text-warning' : 'text-xs text-text-tertiary'}>
            {model.activeCount} active · {model.totalCount} total
          </span>
        ) : null}
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
