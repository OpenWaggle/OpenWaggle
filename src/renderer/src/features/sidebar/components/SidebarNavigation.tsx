import {
  ArrowDownAZ,
  Calendar,
  Check,
  Clock,
  Edit3,
  FolderPlus,
  LayoutList,
  Settings,
  Sparkles,
} from 'lucide-react'
import openwaggleLockup from '@/assets/openwaggle-lockup.png'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
import { SIDEBAR_LAYOUT } from '../constants'
import type { SidebarSessionSortMode } from '../lib/sidebar-project-groups'
import type { SidebarView } from '../model'

const SORT_OPTIONS: { value: SidebarSessionSortMode; label: string; icon: typeof Clock }[] = [
  { value: 'recent', label: 'Recent', icon: Clock },
  { value: 'oldest', label: 'Oldest', icon: Calendar },
  { value: 'name', label: 'Name (A->Z)', icon: ArrowDownAZ },
]

export function SidebarBrandArea({ isFullscreen }: { readonly isFullscreen: boolean }) {
  return (
    <>
      <div
        className="drag-region shrink-0 transition-[height] duration-200 ease-out"
        style={{ height: isFullscreen ? 0 : SIDEBAR_LAYOUT.DRAG_REGION_HEIGHT }}
      />
      <div className="drag-region flex shrink-0 items-center px-4 py-1">
        <img
          src={openwaggleLockup}
          alt="OpenWaggle"
          className="no-drag h-12 w-auto object-contain"
        />
      </div>
      <div
        className="shrink-0 transition-[height] duration-200 ease-out"
        style={{
          height: isFullscreen
            ? SIDEBAR_LAYOUT.FULLSCREEN_SPACER_HEIGHT
            : SIDEBAR_LAYOUT.WINDOWED_SPACER_HEIGHT,
        }}
      />
    </>
  )
}

export function SidebarPrimaryActions({
  activeView,
  onNewSession,
  onOpenSkills,
}: {
  readonly activeView: SidebarView
  readonly onNewSession: () => void
  readonly onOpenSkills: () => void
}) {
  return (
    <div className="shrink-0">
      <Button
        variant="row"
        size="none"
        radius="none"
        aria-label="New session"
        onClick={onNewSession}
        className="no-drag h-[34px] gap-2 px-3"
      >
        <Edit3 className="size-3.5 shrink-0 text-text-tertiary" />
        <span className="text-[14px] text-text-secondary">New session</span>
      </Button>

      <Button
        variant={activeView === 'skills' ? 'subtle' : 'row'}
        size="none"
        radius="none"
        aria-label="Skills"
        onClick={onOpenSkills}
        className={cn('no-drag h-8 gap-2 px-3', activeView === 'skills' && 'text-text-primary')}
        title="Open skills"
      >
        <Sparkles className="size-3.5 shrink-0 text-text-tertiary" />
        <span className="text-[14px]">Skills</span>
      </Button>
    </div>
  )
}

export function SidebarProjectsHeader({
  sortMenuOpen,
  sortMode,
  onOpenProject,
  onSetSortMenuOpen,
  onSetSortMode,
}: {
  readonly sortMenuOpen: boolean
  readonly sortMode: SidebarSessionSortMode
  readonly onOpenProject: () => void
  readonly onSetSortMenuOpen: (open: boolean) => void
  readonly onSetSortMode: (mode: SidebarSessionSortMode) => void
}) {
  return (
    <div className="no-drag flex h-[30px] shrink-0 items-center justify-between px-4">
      <span className="text-[12px] font-medium text-text-tertiary">Projects</span>
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon-xs"
          radius="sm"
          aria-label="Open project folder"
          onClick={onOpenProject}
          title="Open project folder"
        >
          <FolderPlus className="size-[13px]" />
        </Button>
        <Popover
          open={sortMenuOpen}
          onOpenChange={onSetSortMenuOpen}
          placement="bottom-end"
          className="min-w-[150px] py-1"
          trigger={
            <Button
              variant="ghost"
              size="icon-xs"
              radius="sm"
              aria-label="Sort sessions"
              onClick={() => onSetSortMenuOpen(!sortMenuOpen)}
              className={cn(sortMenuOpen && 'text-text-primary')}
              title="Sort sessions"
            >
              <LayoutList className="size-3" />
            </Button>
          }
        >
          {SORT_OPTIONS.map((option) => (
            <Button
              variant="row"
              size="xs"
              radius="none"
              key={option.value}
              onClick={() => {
                onSetSortMode(option.value)
                onSetSortMenuOpen(false)
              }}
              className={cn('gap-2', sortMode === option.value && 'text-accent')}
            >
              <option.icon className="size-3 shrink-0" />
              <span className="flex-1">{option.label}</span>
              {sortMode === option.value ? <Check className="size-3 shrink-0" /> : null}
            </Button>
          ))}
        </Popover>
      </div>
    </div>
  )
}

export function SidebarSettingsButton({ onOpenSettings }: { readonly onOpenSettings: () => void }) {
  return (
    <div className="no-drag shrink-0">
      <Button
        variant="row"
        size="none"
        radius="none"
        aria-label="Settings"
        onClick={onOpenSettings}
        className="h-9 gap-2.5 px-4"
      >
        <Settings className="size-3.5" />
        <span className="text-[14px] text-text-secondary">Settings</span>
      </Button>
    </div>
  )
}
