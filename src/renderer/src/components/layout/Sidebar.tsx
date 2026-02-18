import type { ConversationId } from '@shared/types/brand'
import type { ConversationSummary } from '@shared/types/conversation'
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  MessageSquare,
  PenLine,
  Settings,
  Sparkles,
  Trash2,
  Zap,
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
    <aside className="flex h-full w-[252px] shrink-0 flex-col border-r border-border bg-[#171916]">
      {/* Traffic light area */}
      <div className="drag-region h-[44px] shrink-0" />

      {/* Nav actions */}
      <nav className="no-drag space-y-1 px-4 py-2">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-text-primary transition-colors hover:bg-bg-hover/70"
        >
          <PenLine className="h-3.5 w-3.5 text-text-tertiary" />
          New thread
        </button>
        <button
          type="button"
          disabled
          className="flex w-full cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-text-tertiary/75"
        >
          <Zap className="h-3.5 w-3.5" />
          Automations
        </button>
        <button
          type="button"
          disabled
          className="flex w-full cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-text-tertiary/75"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Skills
        </button>
      </nav>

      {/* Separator */}
      <div className="mx-4 my-3 h-px bg-border/70" />

      {/* Thread section header */}
      <div className="mb-2 flex items-center justify-between px-4">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-text-tertiary uppercase">
          Threads
        </span>
        <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-text-muted">
          {conversations.length}
        </span>
      </div>

      {/* Scrollable thread list */}
      <div className="no-drag flex-1 overflow-y-auto px-4 pb-4">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <MessageSquare className="h-5 w-5 text-text-muted/75" />
            <p className="text-xs text-text-muted">No threads yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {groups.map((group) => {
              const groupKey = group.path ?? '__none__'
              const isCollapsed = collapsedGroups.has(groupKey)

              return (
                <div key={groupKey}>
                  {/* Project group header */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(groupKey)}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-text-tertiary transition-colors hover:bg-bg-hover/50 hover:text-text-secondary"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3 w-3 shrink-0" />
                    ) : (
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    )}
                    <FolderOpen className="h-3 w-3 shrink-0" />
                    <span className="truncate font-medium">{group.displayName}</span>
                  </button>

                  {/* Thread items */}
                  {!isCollapsed && (
                    <div className="ml-2 mt-1 space-y-0.5 border-l border-border/45 pl-2">
                      {group.conversations.map((conv) => {
                        const isActive = conv.id === activeId
                        return (
                          <div
                            key={String(conv.id)}
                            className={cn(
                              'group relative flex cursor-pointer items-center rounded-lg transition-colors',
                              isActive
                                ? 'bg-bg-active/60 text-text-primary'
                                : 'text-text-secondary hover:bg-bg-hover/65 hover:text-text-primary',
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => onSelect(conv.id)}
                              className="flex min-w-0 flex-1 items-center justify-between px-2.5 py-1.5 text-left"
                            >
                              <span className="truncate text-[12.5px] leading-snug">
                                {truncate(conv.title, 26)}
                              </span>
                              <span className="ml-2 shrink-0 text-[11px] leading-snug text-text-muted">
                                {formatRelativeTime(conv.updatedAt)}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onDelete(conv.id)
                              }}
                              className="invisible mr-1 shrink-0 rounded-md p-1 text-text-muted transition-colors group-hover:visible hover:bg-error/12 hover:text-error"
                              title="Delete thread"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Settings at bottom */}
      <div className="no-drag shrink-0 border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-text-tertiary transition-colors hover:bg-bg-hover/85 hover:text-text-secondary"
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </button>
      </div>
    </aside>
  )
}
