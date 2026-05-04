import type { ConversationId, SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { useQuery } from '@tanstack/react-query'
import { Archive, ChevronDown, ChevronRight, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { groupConversationsByProject, type ProjectGroup } from '@/components/layout/sidebar-utils'
import { cn } from '@/lib/cn'
import { formatRelativeTime, projectName } from '@/lib/format'
import { api } from '@/lib/ipc'
import {
  archivedConversationsQueryOptions,
  archivedSessionBranchesQueryOptions,
  useArchivedDeleteConversationMutation,
  useRestoreSessionBranchMutation,
  useUnarchiveConversationMutation,
} from '@/queries/archived-conversations'
import { useComposerStore } from '@/stores/composer-store'
import { useSessionStore } from '@/stores/session-store'

function describeArchivedError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

interface ArchivedBranchProjectGroup {
  readonly path: string | null
  readonly sessions: readonly SessionSummary[]
}

function groupArchivedBranchesByProject(
  sessions: readonly SessionSummary[],
): readonly ArchivedBranchProjectGroup[] {
  const groups = new Map<string, ArchivedBranchProjectGroup>()
  for (const session of sessions) {
    const key = session.projectPath ?? '__none__'
    const group = groups.get(key)
    if (group) {
      groups.set(key, { ...group, sessions: [...group.sessions, session] })
    } else {
      groups.set(key, { path: session.projectPath, sessions: [session] })
    }
  }
  return Array.from(groups.values())
}

function archivedBranchCount(group: ArchivedBranchProjectGroup): number {
  return group.sessions.reduce((count, session) => count + (session.branches?.length ?? 0), 0)
}

interface ArchivedGroupProps {
  readonly group: ProjectGroup
  readonly onRestore: (id: ConversationId) => void
  readonly onDelete: (id: ConversationId) => void
}

function ArchivedGroup({ group, onRestore, onDelete }: ArchivedGroupProps) {
  const [collapsed, setCollapsed] = useState(false)
  const Chevron = collapsed ? ChevronRight : ChevronDown

  return (
    <div>
      <button
        type="button"
        onClick={() => setCollapsed((p) => !p)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-bg-hover"
      >
        <Chevron className="h-3 w-3 shrink-0 text-text-muted" />
        <span className="text-[13px] font-medium text-text-secondary">
          {group.path ? projectName(group.path) : 'No project'}
        </span>
        <span className="text-[11px] text-text-muted">({group.conversations.length})</span>
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-1 pt-1 pl-2">
            {group.conversations.map((conv) => (
              <div
                key={String(conv.id)}
                className={cn(
                  'group flex items-center gap-3 rounded-md border border-border px-3 py-2',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-text-secondary">{conv.title}</p>
                  <p className="text-[11px] text-text-muted">
                    {conv.messageCount} messages · {formatRelativeTime(conv.updatedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRestore(conv.id)}
                  className="shrink-0 rounded-md px-2 py-1 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                  title="Restore session"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(conv.id)}
                  className="shrink-0 rounded-md px-2 py-1 text-[12px] text-text-muted transition-colors hover:bg-bg-hover hover:text-error"
                  title="Delete permanently"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

interface ArchivedBranchGroupProps {
  readonly group: ArchivedBranchProjectGroup
  readonly onRestoreBranch: (sessionId: SessionId, branchId: SessionBranchId) => void
}

function ArchivedBranchGroup({ group, onRestoreBranch }: ArchivedBranchGroupProps) {
  const [collapsed, setCollapsed] = useState(false)
  const Chevron = collapsed ? ChevronRight : ChevronDown
  const count = archivedBranchCount(group)

  return (
    <div>
      <button
        type="button"
        onClick={() => setCollapsed((p) => !p)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-bg-hover"
      >
        <Chevron className="h-3 w-3 shrink-0 text-text-muted" />
        <span className="text-[13px] font-medium text-text-secondary">
          {group.path ? projectName(group.path) : 'No project'}
        </span>
        <span className="text-[11px] text-text-muted">({count})</span>
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-2 pt-1 pl-2">
            {group.sessions.map((session) => (
              <div key={String(session.id)} className="rounded-md border border-border px-3 py-2">
                <div className="mb-2 min-w-0">
                  <p className="truncate text-[13px] text-text-secondary">{session.title}</p>
                  <p className="text-[11px] text-text-muted">
                    Updated {formatRelativeTime(session.updatedAt)}
                  </p>
                </div>
                <div className="space-y-1">
                  {(session.branches ?? []).map((branch) => (
                    <div
                      key={String(branch.id)}
                      className="flex items-center gap-3 rounded-md bg-bg-secondary px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] text-text-secondary">{branch.name}</p>
                        <p className="text-[11px] text-text-muted">
                          Branch · {formatRelativeTime(branch.updatedAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRestoreBranch(session.id, branch.id)}
                        className="shrink-0 rounded-md px-2 py-1 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                        title="Restore branch"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function ArchivedSection() {
  const archivedQuery = useQuery(archivedConversationsQueryOptions())
  const archivedBranchesQuery = useQuery(archivedSessionBranchesQueryOptions())
  const unarchiveMutation = useUnarchiveConversationMutation()
  const restoreBranchMutation = useRestoreSessionBranchMutation()
  const deleteMutation = useArchivedDeleteConversationMutation()
  const loadSessions = useSessionStore((state) => state.loadSessions)
  const [actionError, setActionError] = useState<string | null>(null)

  function handleRestore(id: ConversationId): void {
    setActionError(null)
    void unarchiveMutation
      .mutateAsync(id)
      .then(() => {
        void loadSessions()
      })
      .catch((error: unknown) => {
        setActionError(describeArchivedError(error, 'Failed to restore archived session.'))
      })
  }

  function handleRestoreBranch(sessionId: SessionId, branchId: SessionBranchId): void {
    setActionError(null)
    void restoreBranchMutation
      .mutateAsync({ sessionId, branchId })
      .then(() => {
        void loadSessions()
      })
      .catch((error: unknown) => {
        setActionError(describeArchivedError(error, 'Failed to restore archived branch.'))
      })
  }

  function handleDelete(id: ConversationId): void {
    setActionError(null)
    void api
      .showConfirm(
        'Delete permanently?',
        'This session will be permanently deleted. This cannot be undone.',
      )
      .then((confirmed) => {
        if (!confirmed) return
        void deleteMutation
          .mutateAsync(id)
          .then(() => {
            useComposerStore.getState().clearScopedDraftsForSession(String(id))
          })
          .catch((error: unknown) => {
            setActionError(
              describeArchivedError(error, 'Failed to permanently delete archived session.'),
            )
          })
      })
      .catch((error: unknown) => {
        setActionError(describeArchivedError(error, 'Failed to open delete confirmation.'))
      })
  }

  if (archivedQuery.isPending || archivedBranchesQuery.isPending) {
    return (
      <div className="flex items-center justify-center py-20 text-text-muted text-[13px]">
        Loading archived sessions...
      </div>
    )
  }

  const archived = archivedQuery.data ?? []
  const archivedBranchSessions = archivedBranchesQuery.data ?? []
  const queryError = archivedQuery.error
    ? describeArchivedError(archivedQuery.error, 'Failed to load archived sessions.')
    : archivedBranchesQuery.error
      ? describeArchivedError(archivedBranchesQuery.error, 'Failed to load archived branches.')
      : null

  if (queryError && archived.length === 0 && archivedBranchSessions.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <p
          role="alert"
          className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-[13px] text-error"
        >
          {queryError}
        </p>
      </div>
    )
  }

  if (archived.length === 0 && archivedBranchSessions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <Archive className="h-6 w-6 text-text-muted/60" />
        <p className="text-[13px] text-text-muted">No archived sessions or branches</p>
      </div>
    )
  }

  const groups = groupConversationsByProject(archived)
  const branchGroups = groupArchivedBranchesByProject(archivedBranchSessions)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-medium text-text-primary">
          Archived sessions and branches
        </h2>
        <p className="mt-1 text-[13px] text-text-tertiary">
          Sessions and branches removed from normal navigation. Restore them to bring them back.
        </p>
      </div>

      {actionError && (
        <p
          role="alert"
          className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-[13px] text-error"
        >
          {actionError}
        </p>
      )}

      {queryError && (
        <p className="rounded-md border border-error/20 bg-error/5 px-3 py-2 text-[13px] text-error">
          {queryError}
        </p>
      )}

      {groups.length > 0 ? (
        <div className="space-y-2">
          <h3 className="px-2 text-[12px] font-medium text-text-tertiary">Archived sessions</h3>
          {groups.map((group) => (
            <ArchivedGroup
              key={group.path ?? '__none__'}
              group={group}
              onRestore={handleRestore}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : null}

      {branchGroups.length > 0 ? (
        <div className="space-y-2">
          <h3 className="px-2 text-[12px] font-medium text-text-tertiary">Archived branches</h3>
          {branchGroups.map((group) => (
            <ArchivedBranchGroup
              key={group.path ?? '__none__'}
              group={group}
              onRestoreBranch={handleRestoreBranch}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
