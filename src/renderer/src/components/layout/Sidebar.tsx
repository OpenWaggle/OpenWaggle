import type { ConversationId } from '@shared/types/brand'
import type { ConversationSummary } from '@shared/types/conversation'
import {
  Edit3,
  Folder,
  FolderPlus,
  LayoutList,
  MessageSquare,
  RotateCw,
  Settings,
  Sparkles,
  SquareTerminal,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { formatRelativeTime, projectName, truncate } from '@/lib/format'

interface SidebarProps {
  conversations: ConversationSummary[]
  activeId: ConversationId | null
  onSelect: (id: ConversationId) => void
  onDelete: (id: ConversationId) => void
  onNew: () => void
  onOpenSettings: () => void
}

interface ProjectGroup {
  path: string | null
  displayName: string
  conversations: ConversationSummary[]
}

function groupByProject(conversations: ConversationSummary[]): ProjectGroup[] {
  const groups = new Map<string, ConversationSummary[]>()

  for (const conv of conversations) {
    const key = conv.projectPath ?? '__none__'
    const existing = groups.get(key)
    if (existing) {
      existing.push(conv)
    } else {
      groups.set(key, [conv])
    }
  }

  const result: ProjectGroup[] = []
  for (const [key, convs] of groups) {
    result.push({
      path: key === '__none__' ? null : key,
      displayName: key === '__none__' ? 'No project' : projectName(key),
      conversations: convs,
    })
  }

  return result
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onNew,
  onOpenSettings,
}: SidebarProps): React.JSX.Element {
  const groups = groupByProject(conversations)
  const [hoveredThread, setHoveredThread] = useState<ConversationId | null>(null)

  return (
    <aside className="flex h-full w-[224px] shrink-0 flex-col border-r border-border bg-bg-secondary">
      {/* Logo area — also acts as drag region */}
      <div className="drag-region flex h-[48px] shrink-0 items-center gap-2 px-4">
        <SquareTerminal className="no-drag h-4 w-4 text-accent" />
        <span className="no-drag text-[13px] font-semibold text-text-primary">HiveCode</span>
      </div>

      {/* Nav actions */}
      <nav className="no-drag space-y-0.5 px-3">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-md px-3 py-[7px] text-[13px] text-text-secondary transition-colors hover:bg-bg-hover"
        >
          <Edit3 className="h-3.5 w-3.5 text-text-tertiary" />
          New thread
        </button>
        <button
          type="button"
          disabled
          className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-3 py-[7px] text-[13px] text-text-tertiary/75"
        >
          <RotateCw className="h-3.5 w-3.5" />
          Automations
        </button>
        <button
          type="button"
          disabled
          className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-3 py-[7px] text-[13px] text-text-tertiary/75"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Skills
        </button>
      </nav>

      {/* Thread section header */}
      <div className="mt-4 flex h-[30px] items-center justify-between px-4">
        <span className="text-[11px] font-medium text-text-tertiary">Threads</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled
            className="cursor-not-allowed text-text-tertiary/60 hover:text-text-tertiary"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled
            className="cursor-not-allowed text-text-tertiary/60 hover:text-text-tertiary"
          >
            <LayoutList className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable thread list */}
      <div className="no-drag flex-1 overflow-y-auto px-3 pb-3">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <MessageSquare className="h-5 w-5 text-text-muted/75" />
            <p className="text-xs text-text-muted">No threads yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {groups.map((group) => {
              const groupKey = group.path ?? '__none__'

              return (
                <div key={groupKey}>
                  {/* Project group header */}
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] text-text-tertiary">
                    <Folder className="h-3 w-3 shrink-0" />
                    <span className="truncate">{group.displayName}</span>
                  </div>

                  {/* Thread items */}
                  <div className="space-y-px">
                    {group.conversations.map((conv) => {
                      const isActive = conv.id === activeId
                      const isHovered = hoveredThread === conv.id
                      return (
                        <div
                          key={String(conv.id)}
                          className={cn(
                            'group relative flex cursor-pointer items-center rounded-md transition-colors',
                            isActive
                              ? 'border-l-2 border-accent bg-bg-active'
                              : 'border-l-2 border-transparent hover:bg-bg-hover',
                          )}
                          onMouseEnter={() => setHoveredThread(conv.id)}
                          onMouseLeave={() => setHoveredThread(null)}
                        >
                          <button
                            type="button"
                            onClick={() => onSelect(conv.id)}
                            className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-1.5 text-left"
                          >
                            <span
                              className={cn(
                                'truncate text-[11px] font-medium leading-snug',
                                isActive ? 'text-text-primary' : 'text-text-secondary',
                              )}
                            >
                              {truncate(conv.title, 28)}
                            </span>
                            <span className="text-[10px] text-text-tertiary">
                              {formatRelativeTime(conv.updatedAt)}
                            </span>
                          </button>

                          {isHovered && !isActive && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onDelete(conv.id)
                              }}
                              className="mr-2 shrink-0 rounded-md p-1 text-text-muted transition-colors hover:bg-error/12 hover:text-error"
                              title="Delete thread"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Settings at bottom */}
      <div className="no-drag shrink-0 border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-md px-3 py-[7px] text-[13px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </button>
      </div>
    </aside>
  )
}
