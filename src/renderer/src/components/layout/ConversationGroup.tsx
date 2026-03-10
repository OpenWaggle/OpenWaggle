import type { ConversationId } from '@shared/types/brand'
import { Edit3, Folder, FolderOpen, MoreHorizontal, Pencil, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Popover } from '@/components/shared/Popover'
import { cn } from '@/lib/cn'
import type { ProjectGroup } from './sidebar-utils'
import { ThreadListItem } from './ThreadListItem'

interface ConversationGroupProps {
  readonly group: ProjectGroup
  readonly isCollapsed: boolean
  readonly activeId: ConversationId | null
  readonly onToggle: () => void
  readonly onSelect: (id: ConversationId) => void
  readonly onDelete: (id: ConversationId) => void
  readonly onMarkUnread: (id: ConversationId) => void
  readonly onNewThread: () => void
  readonly onRename: (name: string) => void
  readonly onRemove: () => void
}

export function ConversationGroup({
  group,
  isCollapsed,
  activeId,
  onToggle,
  onSelect,
  onDelete,
  onMarkUnread,
  onNewThread,
  onRename,
  onRemove,
}: ConversationGroupProps): React.JSX.Element {
  const FolderIcon = isCollapsed ? Folder : FolderOpen
  const hasPath = group.path !== null
  const [menuOpen, setMenuOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(group.displayName)
  const inputRef = useRef<HTMLInputElement>(null)

  function commitRename(): void {
    const trimmed = renameValue.trim()
    if (!trimmed) {
      onRename('')
      setIsRenaming(false)
      return
    }
    if (trimmed !== group.displayName) onRename(trimmed)
    setIsRenaming(false)
  }

  function cancelRename(): void {
    setRenameValue(group.displayName)
    setIsRenaming(false)
  }

  return (
    <div>
      {/* Project group header */}
      <div className="group/header flex items-center h-8 px-3 transition-colors hover:bg-bg-hover">
        {/* Left zone — click to toggle collapse */}
        <button
          type="button"
          aria-expanded={!isCollapsed}
          aria-label={`${group.displayName} project group`}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <FolderIcon className="h-3 w-3 shrink-0 text-text-tertiary" />
          {isRenaming ? (
            <input
              ref={(el) => {
                inputRef.current = el
                el?.focus()
              }}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') cancelRename()
              }}
              onClick={(e) => e.stopPropagation()}
              onBlur={commitRename}
              className="min-w-0 flex-1 truncate bg-transparent text-[13px] text-text-secondary outline-none ring-1 ring-border rounded px-1"
            />
          ) : (
            <span className="truncate text-[13px] text-text-secondary">{group.displayName}</span>
          )}
        </button>

        {/* Right zone — hover-revealed action icons */}
        <div
          className={cn(
            'flex items-center gap-0.5 shrink-0',
            menuOpen ? 'visible' : 'invisible group-hover/header:visible',
          )}
        >
          {hasPath && (
            <Popover
              open={menuOpen}
              onOpenChange={setMenuOpen}
              placement="bottom-end"
              className="min-w-[160px] py-1"
              trigger={
                <button
                  type="button"
                  aria-label="Project actions"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen((p) => !p)
                  }}
                  className="rounded p-0.5 text-text-tertiary transition-colors hover:text-text-secondary"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              }
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen(false)
                  setRenameValue(group.displayName)
                  setIsRenaming(true)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
              >
                <Pencil className="h-3 w-3 shrink-0" />
                <span>Edit name</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen(false)
                  onRemove()
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
              >
                <X className="h-3 w-3 shrink-0" />
                <span>Remove</span>
              </button>
            </Popover>
          )}
          <button
            type="button"
            aria-label="New thread in project"
            onClick={(e) => {
              e.stopPropagation()
              onNewThread()
            }}
            className="rounded p-0.5 text-text-tertiary transition-colors hover:text-text-secondary"
            title="New thread"
          >
            <Edit3 className="h-3 w-3" />
          </button>
        </div>
      </div>

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
              onMarkUnread={onMarkUnread}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
