import { SessionId } from '@shared/types/brand'
import {
  type InfiniteData,
  type UseInfiniteQueryResult,
  useInfiniteQuery,
} from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Bot, ChessQueen, X } from 'lucide-react'
import { useSessionStatusStore } from '@/features/sessions/state'
import {
  type HiveTreePage,
  hiveTreeMembers,
  hiveTreeRoot,
  sessionHiveTreeQueryOptions,
} from '@/queries/session-hive-tree'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { type HiveAgentCount, hiveAgentCounts } from '../lib/hive-agent-presentation'
import { buildHiveTreeModel, type HiveStatusOf } from '../lib/hive-tree-model'
import { buildHiveTreeItems, type HiveTreeItem } from '../lib/hive-tree-structure'
import { useHivePanelViewStore } from '../state/hive-panel-view-store'
import { HiveColumnHeader, HiveStateView, loadedCount } from './HiveStateView'
import { HiveTreeView } from './HiveTreeView'

export interface HivePanelProps {
  readonly sessionId: string | null
  readonly onClose: () => void
}

/** One page of the Hive tree query, for passing query state to a subcomponent. */
type HiveTreeQuery = UseInfiniteQueryResult<InfiniteData<HiveTreePage>>

/**
 * The Hive panel: every Session of the current Hive from its Queen down, at any depth (ADR 0051).
 *
 * It is the home of Worker Sessions that are not Pinned. Its default view is a tree, each Worker
 * under the Session that spawned it; "By next actor" groups the same rows by who acts next (issue 380).
 * Opening a member from it navigates with the panel still requested, so the user can move across
 * the Hive without the panel closing.
 */
export function HivePanel({ sessionId, onClose }: HivePanelProps) {
  const query = useInfiniteQuery({
    ...sessionHiveTreeQueryOptions(SessionId(sessionId ?? '')),
    enabled: sessionId !== null,
  })
  const root = hiveTreeRoot(query.data?.pages)
  const members = hiveTreeMembers(query.data?.pages)
  // Live statuses keep a parked request and a starting Run current between Hive reads.
  const statuses = useSessionStatusStore((state) => state.statuses)
  const statusOf = (id: string) => statuses.get(SessionId(id))
  const model = buildHiveTreeModel({ root, members, currentSessionId: sessionId, statusOf })
  const view = useHivePanelViewStore((state) => state.view)
  const navigate = useNavigate()
  const partial = query.hasNextPage

  function openSession(target: string) {
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId: target },
      search: (previous) => ({ ...previous, panel: 'hive' as const }),
    })
  }

  return (
    <section className="flex h-full min-w-0 flex-col bg-diff-bg" aria-label="Hive">
      <HivePanelHeader memberCount={model.memberCount} partial={partial} onClose={onClose} />
      {root !== null ? (
        <HivePanelToolbar agents={hiveAgentCounts(root, members)} partial={partial} />
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {root !== null ? <HiveColumnHeader /> : null}
        <HiveTreeLoadState query={query} />
        {view === 'tree' ? (
          <HiveTreeBody
            root={root}
            members={members}
            currentSessionId={sessionId}
            onOpen={openSession}
            statusOf={statusOf}
          />
        ) : (
          <HiveStateView
            model={model}
            currentSessionId={sessionId}
            partial={partial}
            onOpen={openSession}
          />
        )}
        {root !== null && model.memberCount === 0 && !query.isFetching ? (
          <p className="px-2 py-1.5 text-xs text-text-tertiary">No Workers yet.</p>
        ) : null}
        <HiveLoadMore query={query} />
      </div>
    </section>
  )
}

/** The tree view with the panel's remembered collapsed rows and archived toggle. */
function HiveTreeBody({
  root,
  members,
  currentSessionId,
  onOpen,
  statusOf,
}: {
  readonly root: ReturnType<typeof hiveTreeRoot>
  readonly members: ReturnType<typeof hiveTreeMembers>
  readonly currentSessionId: string | null
  readonly onOpen: (sessionId: string) => void
  readonly statusOf: HiveStatusOf
}) {
  const showArchived = useHivePanelViewStore((state) => state.showArchived)
  const collapsed = useHivePanelViewStore((state) => state.collapsed)
  const setCollapsed = useHivePanelViewStore((state) => state.setCollapsed)
  const items = buildHiveTreeItems({
    root,
    members,
    showArchived,
    collapsed: new Set(Object.keys(collapsed)),
    statusOf,
  })
  return (
    <HiveTreeView
      items={items}
      currentSessionId={currentSessionId}
      onOpen={onOpen}
      onToggle={(item: HiveTreeItem) =>
        setCollapsed(String(item.session.id), item.expanded === true)
      }
    />
  )
}

// shrink-0 and whitespace-nowrap: only the agent summary beside them gives up width, by truncating.
const TOGGLE_CLASS =
  'shrink-0 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs transition-colors hover:bg-bg-hover hover:text-text-primary'

function toggleClass(pressed: boolean) {
  return cn(
    TOGGLE_CLASS,
    pressed ? 'border-accent/60 text-text-primary' : 'border-border text-text-secondary',
  )
}

/** "reviewer ×6 · planner ×2": which Agent definitions this Hive's Sessions run. */
function HiveAgentSummary({
  agents,
  partial,
}: {
  readonly agents: readonly HiveAgentCount[]
  readonly partial: boolean
}) {
  if (agents.length === 0) return null
  const parts = agents.map((agent) => `${agent.name} ×${loadedCount(agent.count, partial)}`)
  return (
    <span
      data-hive-agent-summary=""
      className="mr-auto flex min-w-0 items-center gap-1.5 text-xs text-info-text"
    >
      <Bot aria-hidden="true" className="size-3.5 shrink-0" />
      <span aria-hidden="true" className="truncate" title={parts.join(' · ')}>
        {parts.join(' · ')}
      </span>
      <span className="sr-only">Agent definitions in this Hive: {parts.join(', ')}</span>
    </span>
  )
}

/** The view toggles: "By next actor" for the groups (issue 380), "Show archived" for the tree (#377). */
function HivePanelToolbar({
  agents,
  partial,
}: {
  readonly agents: readonly HiveAgentCount[]
  readonly partial: boolean
}) {
  const view = useHivePanelViewStore((state) => state.view)
  const showArchived = useHivePanelViewStore((state) => state.showArchived)
  const setView = useHivePanelViewStore((state) => state.setView)
  const setShowArchived = useHivePanelViewStore((state) => state.setShowArchived)
  const grouped = view === 'by-next-actor'
  return (
    <div className="flex shrink-0 items-center justify-end gap-1.5 border-b border-border px-3 py-1.5">
      <HiveAgentSummary agents={agents} partial={partial} />
      {grouped ? null : (
        <Button
          variant="unstyled"
          aria-pressed={showArchived}
          className={toggleClass(showArchived)}
          onClick={() => setShowArchived(!showArchived)}
        >
          Show archived
        </Button>
      )}
      <Button
        variant="unstyled"
        aria-pressed={grouped}
        className={toggleClass(grouped)}
        onClick={() => setView(grouped ? 'tree' : 'by-next-actor')}
      >
        By next actor
      </Button>
    </div>
  )
}

function HivePanelHeader({
  memberCount,
  partial,
  onClose,
}: {
  readonly memberCount: number
  /** More pages of the Hive exist, so the count covers only those read so far. */
  readonly partial: boolean
  readonly onClose: () => void
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      <ChessQueen aria-hidden="true" className="size-3.5 text-accent" />
      <span className="flex-1 text-sm font-medium text-text-primary">Hive</span>
      {/* The whole Hive at every depth, unlike the Session Summary's direct-Worker count. */}
      {memberCount > 0 ? (
        <span className="text-xs text-text-tertiary">
          {loadedCount(memberCount, partial)} {memberCount === 1 && !partial ? 'Worker' : 'Workers'}{' '}
          in this Hive
        </span>
      ) : null}
      <Button
        type="button"
        variant="unstyled"
        aria-label="Close Hive panel"
        onClick={onClose}
        className="flex size-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary"
      >
        <X aria-hidden="true" className="size-3.5" />
      </Button>
    </div>
  )
}

/**
 * Pages after the first: a failed page is retried here, in place, so the rows already shown stay
 * and no second "Retry" competes with the initial-load alert.
 */
function HiveLoadMore({ query }: { readonly query: HiveTreeQuery }) {
  if (!query.hasNextPage) return null
  const failed = query.isFetchNextPageError
  return (
    <Button
      variant="unstyled"
      className={
        failed ? 'px-2 py-1 text-sm text-warning' : 'px-2 py-1 text-sm text-text-secondary'
      }
      disabled={query.isFetching}
      onClick={() => void query.fetchNextPage()}
    >
      {failed ? 'Could not load more Workers \u2014 Retry' : 'Load more Workers'}
    </Button>
  )
}

/** The initial load only: once rows are shown, a failure belongs to the page that failed. */
function HiveTreeLoadState({ query }: { readonly query: HiveTreeQuery }) {
  if (!query.isError || query.data !== undefined) return null
  return (
    <div role="alert" className="px-2 py-2 text-sm text-text-secondary">
      <p>Unable to load this Hive.</p>
      <Button
        variant="unstyled"
        onClick={() => void query.refetch()}
        className="text-xs text-accent"
      >
        Retry Hive
      </Button>
    </div>
  )
}
