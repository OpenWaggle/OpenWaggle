import { SessionId } from '@shared/types/brand'
import {
  type InfiniteData,
  type UseInfiniteQueryResult,
  useInfiniteQuery,
} from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ChessQueen, ChevronDown, ChevronRight, X } from 'lucide-react'
import { useId, useState } from 'react'
import {
  type HiveTreePage,
  hiveTreeMembers,
  hiveTreeRoot,
  sessionHiveTreeQueryOptions,
} from '@/queries/session-hive-tree'
import { Button } from '@/shared/ui/Button'
import { buildHiveTreeModel, type HiveTreeRow } from '../lib/hive-tree-model'
import { HIVE_ROW_GRID_STYLE, HiveTreeListItem } from './HiveTreeRow'

export interface HivePanelProps {
  readonly sessionId: string | null
  readonly onClose: () => void
}

/** One page of the Hive tree query, for passing query state to a subcomponent. */
type HiveTreeQuery = UseInfiniteQueryResult<InfiniteData<HiveTreePage, unknown>, Error>

/**
 * The Hive panel: every Session of the current Hive from its Queen down, at any depth (ADR 0051).
 *
 * It is the home of Worker Sessions that are not Pinned. Opening a member from it navigates with
 * the panel still requested, so the user can move across the Hive without the panel closing.
 */
export function HivePanel({ sessionId, onClose }: HivePanelProps) {
  const query = useInfiniteQuery({
    ...sessionHiveTreeQueryOptions(SessionId(sessionId ?? '')),
    enabled: sessionId !== null,
  })
  const model = buildHiveTreeModel({
    root: hiveTreeRoot(query.data?.pages),
    members: hiveTreeMembers(query.data?.pages),
    currentSessionId: sessionId,
  })
  const root = model.root
  const navigate = useNavigate()

  function openSession(target: string) {
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId: target },
      search: (previous) => ({ ...previous, panel: 'hive' as const }),
    })
  }

  return (
    <section className="flex h-full min-w-0 flex-col bg-diff-bg" aria-label="Hive">
      <HivePanelHeader memberCount={model.memberCount} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {model.root !== null ? <HiveColumnHeader /> : null}
        <HiveTreeLoadState query={query} />
        {root !== null ? (
          <HiveTreeListItem
            row={{ session: root, via: null }}
            isCurrent={sessionId !== null && String(root.id) === sessionId}
            onOpen={() => openSession(String(root.id))}
            isRoot
          />
        ) : null}
        {model.root !== null && model.memberCount === 0 && !query.isFetching ? (
          <p className="px-2 py-1.5 text-xs text-text-tertiary">No Workers yet.</p>
        ) : null}
        <HiveTreeGroup
          label="Needs you"
          rows={model.groups.needsYou}
          onOpen={openSession}
          currentSessionId={sessionId}
        />
        <HiveTreeGroup
          label="Review"
          rows={model.groups.review}
          onOpen={openSession}
          currentSessionId={sessionId}
        />
        <HiveTreeGroup
          label="Active"
          rows={model.groups.active}
          onOpen={openSession}
          currentSessionId={sessionId}
        />
        <HiveTreeGroup
          label="Done"
          rows={model.groups.done}
          onOpen={openSession}
          currentSessionId={sessionId}
        />
        <HiveArchivedGroup
          // Its open state belongs to one Hive: moving within the Hive keeps it, another resets it.
          key={String(model.root?.id ?? '')}
          rows={model.groups.archived}
          onOpen={openSession}
          currentSessionId={sessionId}
        />
        <HiveLoadMore query={query} />
      </div>
    </section>
  )
}

/**
 * The one column header over the whole list (ADR 0051 review): it anchors the Workspace and
 * State cells so they read as columns, not stray words. Rows and this header share one grid;
 * the header's padding matches the rows', actions gutter included, so the columns line up.
 */
function HiveColumnHeader() {
  return (
    // Visual only: every row's accessible name already carries its Workspace and state.
    <div
      aria-hidden="true"
      className="pt-1 pr-9 pb-1 pl-2 text-xs font-semibold uppercase tracking-wide text-text-muted"
      style={HIVE_ROW_GRID_STYLE}
    >
      <span>Session</span>
      <span className="text-right" title="Workspace: the checkout or worktree each Session runs in">
        Workspace
      </span>
      <span className="text-right" title="State: what the Worker's Queen expects of it">
        State
      </span>
    </div>
  )
}

function HivePanelHeader({
  memberCount,
  onClose,
}: {
  readonly memberCount: number
  readonly onClose: () => void
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      <ChessQueen aria-hidden="true" className="size-3.5 text-accent" />
      <span className="flex-1 text-sm font-medium text-text-primary">Hive</span>
      {memberCount > 0 ? (
        <span className="text-xs text-text-tertiary">
          {memberCount} {memberCount === 1 ? 'Worker' : 'Workers'}
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

function HiveTreeGroup({
  label,
  rows,
  onOpen,
  currentSessionId,
}: {
  readonly label: string
  readonly rows: readonly HiveTreeRow[]
  readonly onOpen: (sessionId: string) => void
  readonly currentSessionId: string | null
}) {
  if (rows.length === 0) return null
  return (
    <fieldset aria-label={`${label} Hive sessions`} className="m-0 min-w-0 border-0 p-0">
      <div className="px-2 pb-0.5 pt-1 text-xs font-medium tracking-wide text-text-muted uppercase">
        {label}
      </div>
      {rows.map((row) => (
        <HiveTreeListItem
          key={String(row.session.id)}
          row={row}
          isCurrent={currentSessionId !== null && String(row.session.id) === currentSessionId}
          onOpen={() => onOpen(String(row.session.id))}
        />
      ))}
    </fieldset>
  )
}

function HiveArchivedGroup({
  rows,
  onOpen,
  currentSessionId,
}: {
  readonly rows: readonly HiveTreeRow[]
  readonly onOpen: (sessionId: string) => void
  readonly currentSessionId: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  if (rows.length === 0) return null
  return (
    <div>
      <Button
        variant="unstyled"
        className="flex min-h-7 items-center gap-1 rounded px-2 text-xs font-medium text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary"
        // The visible text is the name, so the count reaches screen readers; aria-expanded says
        // whether the group is open.
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? (
          <ChevronDown aria-hidden="true" className="size-3" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-3" />
        )}
        Archived · {rows.length}
      </Button>
      {/* The list stays in the DOM, hidden while collapsed, so aria-controls always resolves;
          its rows mount only when shown. The toggle row is its only visible label. */}
      <fieldset
        id={listId}
        hidden={!expanded}
        aria-label="Archived Hive sessions"
        className="m-0 min-w-0 border-0 p-0"
      >
        {expanded
          ? rows.map((row) => (
              <HiveTreeListItem
                key={String(row.session.id)}
                row={row}
                isCurrent={currentSessionId !== null && String(row.session.id) === currentSessionId}
                onOpen={() => onOpen(String(row.session.id))}
              />
            ))
          : null}
      </fieldset>
    </div>
  )
}
