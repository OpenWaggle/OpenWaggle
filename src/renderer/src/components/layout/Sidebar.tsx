import type { ConversationId } from '@shared/types/brand'
import type { ConversationSummary } from '@shared/types/conversation'
import {
  Edit3,
  Folder,
  FolderOpen,
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
import { useFullscreen } from '@/hooks/useFullscreen'
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
  const isFullscreen = useFullscreen()
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  function toggleGroup(key: string): void {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <aside className="flex h-full w-[224px] shrink-0 flex-col justify-between bg-bg-secondary border-r border-border">
      {/* sidebar-top */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* macOS traffic light clearance — collapses in fullscreen */}
        <div
          className="drag-region shrink-0 transition-[height] duration-200 ease-out"
          style={{ height: isFullscreen ? 0 : 24 }}
        />
        {/* Logo — drag region, padding [14,16] */}
        <div className="drag-region flex shrink-0 items-center gap-2 px-4 py-[14px]">
          <SquareTerminal className="no-drag h-4 w-4 text-accent" />
          <span className="no-drag text-[13px] font-semibold text-text-primary">HiveCode</span>
        </div>

        {/* Nav items — fixed */}
        <div className="shrink-0">
          {/* New thread — h34, padding [0,12], gap 8 */}
          <button
            type="button"
            onClick={onNew}
            className="no-drag flex w-full items-center gap-2 h-[34px] px-3 text-left transition-colors hover:bg-bg-hover"
          >
            <Edit3 className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            <span className="text-[13px] text-text-secondary">New thread</span>
          </button>

          {/* Automations — h32, padding [0,12], gap 8 */}
          <button
            type="button"
            disabled
            className="no-drag flex w-full cursor-not-allowed items-center gap-2 h-8 px-3"
          >
            <RotateCw className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            <span className="text-[13px] text-text-secondary/60">Automations</span>
          </button>

          {/* Skills — h32, padding [0,12], gap 8 */}
          <button
            type="button"
            disabled
            className="no-drag flex w-full cursor-not-allowed items-center gap-2 h-8 px-3"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            <span className="text-[13px] text-text-secondary/60">Skills</span>
          </button>
        </div>

        {/* Threads header — h30, padding [0,16], justify-between */}
        <div className="no-drag flex shrink-0 items-center justify-between h-[30px] px-4">
          <span className="text-[11px] font-medium text-text-tertiary">Threads</span>
          <div className="flex items-center gap-1.5">
            <FolderPlus className="h-[13px] w-[13px] text-text-tertiary" />
            <LayoutList className="h-3 w-3 text-text-tertiary" />
          </div>
        </div>

        {/* Scrollable thread list */}
        <div className="no-drag flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <MessageSquare className="h-5 w-5 text-text-muted/75" />
              <p className="text-xs text-text-muted">No threads yet</p>
            </div>
          ) : (
            groups.map((group) => {
              const groupKey = group.path ?? '__none__'
              const isCollapsed = collapsedGroups.has(groupKey)
              const FolderIcon = isCollapsed ? Folder : FolderOpen
              return (
                <div key={groupKey}>
                  {/* Project group header — h32, padding [0,12], gap 8 */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(groupKey)}
                    className="flex w-full items-center gap-2 h-8 px-3 transition-colors hover:bg-bg-hover"
                  >
                    <FolderIcon className="h-3 w-3 shrink-0 text-text-tertiary" />
                    <span className="truncate text-[12px] text-text-secondary">
                      {group.displayName}
                    </span>
                  </button>

                  {/* Thread items — animated collapse via grid-rows */}
                  <div
                    className="grid transition-[grid-template-rows] duration-200 ease-out"
                    style={{ gridTemplateRows: isCollapsed ? '0fr' : '1fr' }}
                  >
                    <div className="overflow-hidden">
                      {group.conversations.map((conv) => {
                        const isActive = conv.id === activeId
                        return (
                          <div
                            key={String(conv.id)}
                            className={cn(
                              'group flex items-center h-[34px] w-full',
                              isActive
                                ? 'bg-bg-active border-l-2 border-accent pr-3 pl-6'
                                : 'px-3 hover:bg-bg-hover',
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => onSelect(conv.id)}
                              className="flex min-w-0 flex-1 items-center gap-1.5"
                            >
                              <span
                                className={cn(
                                  'truncate text-[11px]',
                                  isActive ? 'font-medium text-text-primary' : 'text-text-secondary',
                                )}
                              >
                                {truncate(conv.title, 20)}
                              </span>
                              <span className="shrink-0 text-[10px] text-text-tertiary">
                                {formatRelativeTime(conv.updatedAt)}
                              </span>
                            </button>

                            {!isActive && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onDelete(conv.id)
                                }}
                                className="invisible ml-1 shrink-0 rounded-md p-0.5 text-text-muted transition-colors group-hover:visible hover:text-error"
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
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* sidebar-bottom — no border-top */}
      <div className="no-drag shrink-0">
        {/* Settings — h36, padding [0,16], gap 10 */}
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2.5 h-9 px-4 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          <Settings className="h-3.5 w-3.5" />
          <span className="text-[13px] text-text-secondary">Settings</span>
        </button>
      </div>
    </aside>
  )
}
