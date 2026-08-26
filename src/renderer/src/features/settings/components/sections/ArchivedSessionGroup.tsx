import type { SessionId } from '@shared/types/brand'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { ProjectGroup } from '@/features/sidebar/lib'
import { projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { ArchivedSessionRow } from './ArchivedSessionRow'

interface ArchivedSessionGroupProps {
  readonly group: ProjectGroup
  readonly onRestore: (id: SessionId) => void
  readonly onDelete: (id: SessionId) => void
}

export function ArchivedSessionGroup({ group, onRestore, onDelete }: ArchivedSessionGroupProps) {
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
        <span className="text-xs font-medium text-text-secondary">
          {group.path ? projectName(group.path) : 'No project'}
        </span>
        <span className="text-xs text-text-muted">({group.sessions.length})</span>
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
