import type { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { Archive, ChevronDown, ChevronRight, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ProjectGroup } from '@/features/sidebar/lib'
import { cn } from '@/shared/lib/cn'
import { formatRelativeTime, projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import type { ArchivedBranchProjectGroup } from './archived-branch-groups'

function archivedBranchCount(group: ArchivedBranchProjectGroup) {
  return group.sessions.reduce((count, session) => count + (session.branches?.length ?? 0), 0)
}

interface ArchivedGroupProps {
  readonly group: ProjectGroup
  readonly onRestore: (id: SessionId) => void
  readonly onDelete: (id: SessionId) => void
}

export function ArchivedGroup({ group, onRestore, onDelete }: ArchivedGroupProps) {
  const [collapsed, setCollapsed] = useState(false)
  const Chevron = collapsed ? ChevronRight : ChevronDown

  return (
    <div>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => setCollapsed((p) => !p)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-bg-hover"
      >
        <Chevron className="size-3 shrink-0 text-text-muted" />
        <span className="text-[13px] font-medium text-text-secondary">
          {group.path ? projectName(group.path) : 'No project'}
        </span>
        <span className="text-[11px] text-text-muted">({group.sessions.length})</span>
      </Button>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-1 pt-1 pl-2">
            {group.sessions.map((session) => (
              <ArchivedSessionRow
                key={String(session.id)}
                session={session}
                onRestore={onRestore}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ArchivedSessionRow({
  session,
  onRestore,
  onDelete,
}: {
  readonly session: SessionSummary
  readonly onRestore: (id: SessionId) => void
  readonly onDelete: (id: SessionId) => void
}) {
  return (
    <div className={cn('group flex items-center gap-3 rounded-md border border-border px-3 py-2')}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-text-secondary">{session.title}</p>
        <p className="text-[11px] text-text-muted">
          {session.messageCount} messages · {formatRelativeTime(session.updatedAt)}
        </p>
      </div>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onRestore(session.id)}
        className="shrink-0 rounded-md px-2 py-1 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        title="Restore session"
      >
        <RotateCcw className="size-3.5" />
      </Button>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onDelete(session.id)}
        className="shrink-0 rounded-md px-2 py-1 text-[12px] text-text-muted transition-colors hover:bg-bg-hover hover:text-error"
        title="Delete permanently"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}

interface ArchivedBranchGroupProps {
  readonly group: ArchivedBranchProjectGroup
  readonly onRestoreBranch: (sessionId: SessionId, branchId: SessionBranchId) => void
}

export function ArchivedBranchGroup({ group, onRestoreBranch }: ArchivedBranchGroupProps) {
  const [collapsed, setCollapsed] = useState(false)
  const Chevron = collapsed ? ChevronRight : ChevronDown
  const count = archivedBranchCount(group)

  return (
    <div>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => setCollapsed((p) => !p)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-bg-hover"
      >
        <Chevron className="size-3 shrink-0 text-text-muted" />
        <span className="text-[13px] font-medium text-text-secondary">
          {group.path ? projectName(group.path) : 'No project'}
        </span>
        <span className="text-[11px] text-text-muted">({count})</span>
      </Button>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-2 pt-1 pl-2">
            {group.sessions.map((session) => (
              <ArchivedBranchSession
                key={String(session.id)}
                session={session}
                onRestoreBranch={onRestoreBranch}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ArchivedBranchSession({
  session,
  onRestoreBranch,
}: {
  readonly session: SessionSummary
  readonly onRestoreBranch: (sessionId: SessionId, branchId: SessionBranchId) => void
}) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
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
            <Button
              variant="unstyled"
              type="button"
              onClick={() => onRestoreBranch(session.id, branch.id)}
              className="shrink-0 rounded-md px-2 py-1 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              title="Restore branch"
            >
              <RotateCcw className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

interface ArchivedSectionContentProps {
  readonly groups: readonly ProjectGroup[]
  readonly branchGroups: readonly ArchivedBranchProjectGroup[]
  readonly actionError: string | null
  readonly queryError: string | null
  readonly onRestore: (id: SessionId) => void
  readonly onDelete: (id: SessionId) => void
  readonly onRestoreBranch: (sessionId: SessionId, branchId: SessionBranchId) => void
}

export function ArchivedSectionContent({
  groups,
  branchGroups,
  actionError,
  queryError,
  onRestore,
  onDelete,
  onRestoreBranch,
}: ArchivedSectionContentProps) {
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
      {actionError && <ArchivedErrorAlert message={actionError} />}
      {queryError && <ArchivedErrorAlert message={queryError} subtle />}
      {groups.length > 0 ? (
        <div className="space-y-2">
          <h3 className="px-2 text-[12px] font-medium text-text-tertiary">Archived sessions</h3>
          {groups.map((group) => (
            <ArchivedGroup
              key={group.path ?? '__none__'}
              group={group}
              onRestore={onRestore}
              onDelete={onDelete}
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
              onRestoreBranch={onRestoreBranch}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ArchivedEmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <Archive className="size-6 text-text-muted/60" />
      <p className="text-[13px] text-text-muted">No archived sessions or branches</p>
    </div>
  )
}

export function ArchivedErrorAlert({
  message,
  subtle = false,
}: {
  readonly message: string
  readonly subtle?: boolean
}) {
  return (
    <p
      role="alert"
      className={cn(
        'rounded-md px-3 py-2 text-[13px] text-error',
        subtle ? 'border border-error/20 bg-error/5' : 'border border-error/30 bg-error/10',
      )}
    >
      {message}
    </p>
  )
}
