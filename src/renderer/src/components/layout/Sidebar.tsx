import type { ConversationId } from '@shared/types/brand'
import type { ConversationSummary } from '@shared/types/conversation'
import {
  ArrowDownAZ,
  Calendar,
  Check,
  Clock,
  Edit3,
  FolderPlus,
  Hash,
  LayoutList,
  MessageSquare,
  Settings,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import openwaggleLockup from '@/assets/openwaggle-lockup.png'
import { Popover } from '@/components/shared/Popover'
import { useFullscreen } from '@/hooks/useFullscreen'
import { cn } from '@/lib/cn'
import { ConversationGroup } from './ConversationGroup'
import { groupConversationsByProject, type SortMode, sortConversationGroups } from './sidebar-utils'

function McpIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 195 195"
      fill="none"
      className={className}
      stroke="currentColor"
      strokeWidth="16"
      strokeLinecap="round"
    >
      <title>MCP</title>
      <path d="M25 97.85L92.88 29.97a24 24 0 0133.94 0 24 24 0 010 33.94L75.56 115.18" />
      <path d="M76.27 114.47l50.56-50.56a24 24 0 0133.94 0l.35.35a24 24 0 010 33.94l-61.39 61.4a6 6 0 000 8.48l12.6 12.61" />
      <path d="M109.85 46.94L59.65 97.15a24 24 0 000 33.94 24 24 0 0033.94 0l50.2-50.21" />
    </svg>
  )
}

const SORT_OPTIONS: { value: SortMode; label: string; icon: typeof Clock }[] = [
  { value: 'recent', label: 'Recent', icon: Clock },
  { value: 'oldest', label: 'Oldest', icon: Calendar },
  { value: 'name', label: 'Name (A→Z)', icon: ArrowDownAZ },
  { value: 'threads', label: 'Most threads', icon: Hash },
]

interface SidebarProps {
  conversations: ConversationSummary[]
  activeId: ConversationId | null
  activeView: 'chat' | 'skills' | 'settings'
  onSelect: (id: ConversationId) => void
  onDelete: (id: ConversationId) => void
  onNew: () => void
  onOpenProject: () => void
  onOpenSkills: () => void
  onOpenSettings: () => void
}

export function Sidebar({
  conversations,
  activeId,
  activeView,
  onSelect,
  onDelete,
  onNew,
  onOpenProject,
  onOpenSkills,
  onOpenSettings,
}: SidebarProps): React.JSX.Element {
  const groups = groupConversationsByProject(conversations)
  const isFullscreen = useFullscreen()
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)

  const sortedGroups = sortConversationGroups(groups, sortMode)

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
    <aside className="flex h-full w-[272px] shrink-0 flex-col justify-between bg-bg-secondary border-r border-border">
      {/* sidebar-top */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* macOS traffic light clearance — collapses in fullscreen */}
        <div
          className="drag-region shrink-0 transition-[height] duration-200 ease-out"
          style={{ height: isFullscreen ? 0 : 32 }}
        />
        {/* Logo — drag region, padding [14,16] */}
        <div className="drag-region flex shrink-0 items-center px-4 py-1">
          <img
            src={openwaggleLockup}
            alt="OpenWaggle"
            className="no-drag h-12 w-auto object-contain"
          />
        </div>

        <div
          className="shrink-0 transition-[height] duration-200 ease-out"
          style={{ height: isFullscreen ? 104 : 80 }}
        />

        {/* Nav items — fixed */}
        <div className="shrink-0">
          {/* New thread — h34, padding [0,12], gap 8 */}
          <button
            type="button"
            onClick={onNew}
            className="no-drag flex w-full items-center gap-2 h-[34px] px-3 text-left transition-colors hover:bg-bg-hover"
          >
            <Edit3 className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            <span className="text-[14px] text-text-secondary">New thread</span>
          </button>

          {/* MCPs — h32, padding [0,12], gap 8 */}
          <button
            type="button"
            disabled
            className="no-drag flex w-full cursor-not-allowed items-center gap-2 h-8 px-3"
            title="Coming soon"
          >
            <McpIcon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            <span className="text-[14px] text-text-secondary/60">MCPs</span>
          </button>

          {/* Skills — h32, padding [0,12], gap 8 */}
          <button
            type="button"
            onClick={onOpenSkills}
            className={cn(
              'no-drag flex w-full items-center gap-2 h-8 px-3 transition-colors',
              activeView === 'skills'
                ? 'bg-bg-active text-text-primary'
                : 'text-text-secondary hover:bg-bg-hover',
            )}
            title="Open skills"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            <span className="text-[14px]">Skills</span>
          </button>
        </div>

        <div className="shrink-0 h-20" />

        {/* Threads header — h30, padding [0,16], justify-between */}
        <div className="no-drag flex shrink-0 items-center justify-between h-[30px] px-4">
          <span className="text-[12px] font-medium text-text-tertiary">Threads</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenProject}
              className="rounded p-0.5 text-text-tertiary transition-colors hover:text-text-secondary"
              title="Open project folder"
            >
              <FolderPlus className="h-[13px] w-[13px]" />
            </button>
            <Popover
              open={sortMenuOpen}
              onOpenChange={setSortMenuOpen}
              placement="bottom-end"
              className="min-w-[150px] py-1"
              trigger={
                <button
                  type="button"
                  onClick={() => setSortMenuOpen((p) => !p)}
                  className={cn(
                    'rounded p-0.5 transition-colors',
                    sortMenuOpen
                      ? 'text-text-primary'
                      : 'text-text-tertiary hover:text-text-secondary',
                  )}
                  title="Sort projects"
                >
                  <LayoutList className="h-3 w-3" />
                </button>
              }
            >
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setSortMode(opt.value)
                    setSortMenuOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-hover',
                    sortMode === opt.value ? 'text-accent' : 'text-text-secondary',
                  )}
                >
                  <opt.icon className="h-3 w-3 shrink-0" />
                  <span className="flex-1">{opt.label}</span>
                  {sortMode === opt.value && <Check className="h-3 w-3 shrink-0" />}
                </button>
              ))}
            </Popover>
          </div>
        </div>

        {/* Scrollable thread list */}
        <div className="no-drag flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <MessageSquare className="h-5 w-5 text-text-muted/75" />
              <p className="text-[13px] text-text-muted">No threads yet</p>
            </div>
          ) : (
            sortedGroups.map((group) => {
              const groupKey = group.path ?? '__none__'
              return (
                <ConversationGroup
                  key={groupKey}
                  group={group}
                  isCollapsed={collapsedGroups.has(groupKey)}
                  activeId={activeId}
                  onToggle={() => toggleGroup(groupKey)}
                  onSelect={onSelect}
                  onDelete={onDelete}
                />
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
          <span className="text-[14px] text-text-secondary">Settings</span>
        </button>
      </div>
    </aside>
  )
}
