import type { ConversationId } from '@shared/types/brand'
import { Folder, FolderOpen } from 'lucide-react'
import type { ProjectGroup } from './sidebar-utils'
import { ThreadListItem } from './ThreadListItem'

interface ConversationGroupProps {
  readonly group: ProjectGroup
  readonly isCollapsed: boolean
  readonly activeId: ConversationId | null
  readonly onToggle: () => void
  readonly onSelect: (id: ConversationId) => void
  readonly onDelete: (id: ConversationId) => void
}

export function ConversationGroup({
  group,
  isCollapsed,
  activeId,
  onToggle,
  onSelect,
  onDelete,
}: ConversationGroupProps): React.JSX.Element {
  const FolderIcon = isCollapsed ? Folder : FolderOpen

  return (
    <div>
      {/* Project group header — h32, padding [0,12], gap 8 */}
      <button
        type="button"
        aria-expanded={!isCollapsed}
        aria-label={`${group.displayName} project group`}
        onClick={onToggle}
        className="flex w-full items-center gap-2 h-8 px-3 transition-colors hover:bg-bg-hover"
      >
        <FolderIcon className="h-3 w-3 shrink-0 text-text-tertiary" />
        <span className="truncate text-[13px] text-text-secondary">{group.displayName}</span>
      </button>

      {/* Thread items — accordion collapse via grid-rows */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: isCollapsed ? '0fr' : '1fr' }}
      >
        <div className="min-h-0 overflow-hidden">
          {group.conversations.map((conv) => (
            <ThreadListItem
              key={String(conv.id)}
              conversation={conv}
              isActive={conv.id === activeId}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
