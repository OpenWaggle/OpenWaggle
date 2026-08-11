import type { SessionBranchId, SessionId } from '@shared/types/brand'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { ArchivedBranchSession } from './ArchivedBranchSession'
import type { ArchivedBranchProjectGroup } from './archived-branch-groups'

function archivedBranchCount(group: ArchivedBranchProjectGroup) {
  return group.sessions.reduce((count, session) => count + (session.branches?.length ?? 0), 0)
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
