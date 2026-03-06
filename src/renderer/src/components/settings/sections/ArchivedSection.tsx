import type { ConversationId } from '@shared/types/brand'
import { useQuery } from '@tanstack/react-query'
import { Archive, ChevronDown, ChevronRight, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { groupConversationsByProject, type ProjectGroup } from '@/components/layout/sidebar-utils'
import { cn } from '@/lib/cn'
import { formatRelativeTime, projectName } from '@/lib/format'
import { api } from '@/lib/ipc'
import {
  archivedConversationsQueryOptions,
  useArchivedDeleteConversationMutation,
  useUnarchiveConversationMutation,
} from '@/queries/archived-conversations'

function describeArchivedError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

interface ArchivedGroupProps {
  readonly group: ProjectGroup
  readonly onRestore: (id: ConversationId) => void
  readonly onDelete: (id: ConversationId) => void
}

function ArchivedGroup({ group, onRestore, onDelete }: ArchivedGroupProps): React.JSX.Element {
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
                  title="Restore thread"
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

export function ArchivedSection(): React.JSX.Element {
  const archivedQuery = useQuery(archivedConversationsQueryOptions())
  const unarchiveMutation = useUnarchiveConversationMutation()
  const deleteMutation = useArchivedDeleteConversationMutation()
  const [actionError, setActionError] = useState<string | null>(null)

  function handleRestore(id: ConversationId): void {
    setActionError(null)
    void unarchiveMutation.mutateAsync(id).catch((error: unknown) => {
      setActionError(describeArchivedError(error, 'Failed to restore archived thread.'))
    })
  }

  function handleDelete(id: ConversationId): void {
    setActionError(null)
    void api
      .showConfirm(
        'Delete permanently?',
        'This thread will be permanently deleted. This cannot be undone.',
      )
      .then((confirmed) => {
        if (!confirmed) return
        void deleteMutation.mutateAsync(id).catch((error: unknown) => {
          setActionError(
            describeArchivedError(error, 'Failed to permanently delete archived thread.'),
          )
        })
      })
      .catch((error: unknown) => {
        setActionError(describeArchivedError(error, 'Failed to open delete confirmation.'))
      })
  }

  if (archivedQuery.isPending) {
    return (
      <div className="flex items-center justify-center py-20 text-text-muted text-[13px]">
        Loading archived threads…
      </div>
    )
  }

  const archived = archivedQuery.data ?? []
  const queryError = archivedQuery.error
    ? describeArchivedError(archivedQuery.error, 'Failed to load archived threads.')
    : null

  if (queryError && archived.length === 0) {
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

  if (archived.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <Archive className="h-6 w-6 text-text-muted/60" />
        <p className="text-[13px] text-text-muted">No archived threads</p>
      </div>
    )
  }

  const groups = groupConversationsByProject(archived)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-medium text-text-primary">Archived threads</h2>
        <p className="mt-1 text-[13px] text-text-tertiary">
          Threads removed from the sidebar. Restore them to bring them back.
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

      <div className="space-y-2">
        {groups.map((group) => (
          <ArchivedGroup
            key={group.path ?? '__none__'}
            group={group}
            onRestore={handleRestore}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  )
}
