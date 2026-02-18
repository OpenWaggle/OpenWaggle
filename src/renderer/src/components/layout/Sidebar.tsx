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
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-border-light bg-bg">
      {/* Traffic light area */}
      <div className="drag-region h-[52px] shrink-0" />

      {/* Nav actions */}
      <nav className="no-drag space-y-0.5 px-4">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-text-primary hover:bg-bg-hover transition-colors"
        >
          <PenLine className="h-4 w-4 text-text-tertiary" />
          New thread
        </button>
        <button
          type="button"
          disabled
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-text-muted cursor-not-allowed"
        >
          <Zap className="h-4 w-4" />
          Automations
        </button>
        <button
          type="button"
          disabled
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-text-muted cursor-not-allowed"
        >
          <Sparkles className="h-4 w-4" />
          Skills
        </button>
      </nav>

      {/* Separator */}
      <div className="mx-5 my-3 border-t border-border" />

      {/* Thread section header */}
      <div className="mb-2 px-5">
        <span className="text-[11px] font-medium text-text-tertiary tracking-wide">Threads</span>
      </div>

      {/* Scrollable thread list */}
      <div className="no-drag flex-1 overflow-y-auto px-4">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <MessageSquare className="h-5 w-5 text-text-muted" />
            <p className="text-xs text-text-muted">No threads yet</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {groups.map((group) => {
              const groupKey = group.path ?? '__none__'
              const isCollapsed = collapsedGroups.has(groupKey)

              return (
                <div key={groupKey}>
                  {/* Project group header */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(groupKey)}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
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
                    <div className="ml-3 space-y-px">
                      {group.conversations.map((conv) => {
                        const isActive = conv.id === activeId
                        return (
                          <div
                            key={String(conv.id)}
                            className={cn(
                              'group relative flex items-center rounded-lg cursor-pointer transition-colors',
                              isActive
                                ? 'bg-bg-hover text-text-primary'
                                : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => onSelect(conv.id)}
                              className="flex flex-1 items-center justify-between min-w-0 text-left px-2.5 py-2"
                            >
                              <span className="text-[13px] truncate leading-snug">
                                {truncate(conv.title, 24)}
                              </span>
                              <span className="text-[11px] text-text-muted leading-snug shrink-0 ml-2">
                                {formatRelativeTime(conv.updatedAt)}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onDelete(conv.id)
                              }}
                              className="invisible group-hover:visible shrink-0 mr-1.5 rounded p-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
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
      <div className="no-drag shrink-0 border-t border-border px-4 py-2.5">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-colors"
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
      </div>
    </aside>
  )
}
