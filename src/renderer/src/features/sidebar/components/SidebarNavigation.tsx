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
import { SIDEBAR_LAYOUT } from '../constants/sidebar-layout'
import type { SidebarSessionSortMode } from '../lib/sidebar-project-groups'
import type { SidebarView } from '../model/sidebar-types'

const SORT_OPTIONS: { value: SidebarSessionSortMode; label: string; icon: typeof Clock }[] = [
  { value: 'recent', label: 'Recent', icon: Clock },
  { value: 'oldest', label: 'Oldest', icon: Calendar },
  { value: 'name', label: 'Name (A->Z)', icon: ArrowDownAZ },
]

import { SidebarIconButton, SidebarSectionHead } from './SidebarSectionHead'

export function SidebarBrandArea({ isFullscreen }: { readonly isFullscreen: boolean }) {
  return (
    <>
      <div
        className="drag-region shrink-0 transition-[height] duration-200 ease-out"
        style={{ height: isFullscreen ? 0 : SIDEBAR_LAYOUT.DRAG_REGION_HEIGHT }}
      />
      {/*
       * Prototype metrics: a 38px block with 14px side padding. The lockup keeps the product's
       * real artwork rather than the prototype's placeholder square, scaled to the 22px mark the
       * design allows for. It was 48px inside an 88px block, which pushed every row down.
       */}
      <div
        className="drag-region flex shrink-0 items-center px-3.5 pt-2.5 pb-1.5"
        data-qa="sidebar-brand"
      >
        <img
          src={openwaggleLockup}
          alt="OpenWaggle"
          className="no-drag h-[22px] w-auto object-contain"
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

/**
 * Primary actions, ported to the prototype's metrics: 30px rows, 8px inset, 13px text and an
 * 8px gap, inside a 6px gutter with 1px between rows. The app had 34px and 32px rows at 14px
 * with a 12px inset, so the two lists sat at different rhythms.
 */
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
    <div className="flex shrink-0 flex-col gap-px px-1.5 pt-0.5 pb-1.5">
      <Button
        variant="row"
        size="none"
        radius="md"
        aria-label="New session"
        data-qa="sidebar-primary-action"
        onClick={onNewSession}
        className="no-drag flex h-[30px] w-full gap-2 px-2 font-normal text-[13px] text-text-secondary"
      >
        <Edit3 className="size-3.5 shrink-0 text-text-tertiary" />
        <span>New session</span>
        {/* The prototype advertises the shortcut on the row that uses it. */}
        <span
          data-qa="sidebar-kb"
          aria-hidden="true"
          className="ml-auto flex-none rounded border border-border-light bg-bg-tertiary px-1 py-0.5 font-mono text-[10px] text-text-muted leading-none"
        >
          ⌘N
        </span>
      </Button>

      <Button
        variant={activeView === 'skills' ? 'subtle' : 'row'}
        size="none"
        radius="md"
        aria-label="Skills"
        onClick={onOpenSkills}
        className={cn(
          'no-drag flex h-[30px] w-full gap-2 px-2 font-normal text-[13px] text-text-secondary',
          activeView === 'skills' && 'text-text-primary',
        )}
        title="Open skills"
      >
        <Sparkles className="size-3.5 shrink-0 text-text-tertiary" />
        <span>Skills</span>
      </Button>
    </div>
  )
}

/**
 * The Projects heading, on the prototype's shared section-head primitive.
 *
 * Actions are hidden until hover, as in the prototype, so a resting sidebar shows content
 * rather than controls.
 */
export function SidebarProjectsHeader({
  projectCount,
  sortMenuOpen,
  sortMode,
  onOpenProject,
  onSetSortMenuOpen,
  onSetSortMode,
}: {
  readonly projectCount: number
  readonly sortMenuOpen: boolean
  readonly sortMode: SidebarSessionSortMode
  readonly onOpenProject: () => void
  readonly onSetSortMenuOpen: (open: boolean) => void
  readonly onSetSortMode: (mode: SidebarSessionSortMode) => void
}) {
  return (
    <SidebarSectionHead label="Projects" count={projectCount}>
      <SidebarIconButton label="Open project folder" onClick={onOpenProject}>
        <FolderPlus className="size-[13px]" />
      </SidebarIconButton>
      <Popover
        open={sortMenuOpen}
        onOpenChange={onSetSortMenuOpen}
        placement="bottom-end"
        className="min-w-[196px] py-1"
        trigger={
          <SidebarIconButton
            label="Sort sessions"
            isActive={sortMenuOpen}
            onClick={() => onSetSortMenuOpen(!sortMenuOpen)}
          >
            <LayoutList className="size-[13px]" />
          </SidebarIconButton>
        }
      >
        {SORT_OPTIONS.map((option) => (
          <Button
            variant="row"
            size="xs"
            radius="none"
            key={option.value}
            aria-checked={sortMode === option.value}
            role="menuitemradio"
            onClick={() => {
              onSetSortMode(option.value)
              onSetSortMenuOpen(false)
            }}
            className={cn('gap-2 px-3 text-[12px]', sortMode === option.value && 'text-accent')}
          >
            <option.icon className="size-3 shrink-0" />
            <span className="flex-1">{option.label}</span>
            {sortMode === option.value ? <Check className="size-3 shrink-0" /> : null}
          </Button>
        ))}
      </Popover>
    </SidebarSectionHead>
  )
}

/**
 * The footer, on the prototype's metrics: a top border, a 6px gutter, and a 30px row at 12px.
 *
 * The gear icon is deliberately the app's existing one. The prototype swapped in a different
 * glyph and the maintainer asked to keep this.
 */
export function SidebarSettingsButton({ onOpenSettings }: { readonly onOpenSettings: () => void }) {
  return (
    <div className="no-drag shrink-0 border-t border-border px-1.5 py-1">
      <Button
        variant="row"
        size="none"
        radius="md"
        aria-label="Settings"
        data-qa="sidebar-settings"
        onClick={onOpenSettings}
        className="flex h-[30px] w-full gap-2 px-2 font-normal text-[12px] text-text-tertiary"
      >
        <Settings className="size-3.5" />
        <span>Settings</span>
      </Button>
    </div>
  )
}
