import { ChartColumn, Edit3, FolderPlus, Settings } from 'lucide-react'
import openwaggleLockup from '@/assets/openwaggle-lockup.png'
import { Button } from '@/shared/ui/Button'
import { SIDEBAR_LAYOUT } from '../constants/sidebar-layout'
import type { SidebarSessionSortMode } from '../lib/sidebar-sort'
import { SidebarProjectSortMenu } from './SidebarProjectSortMenu'
import { SidebarIconButton, SidebarSectionHead } from './SidebarSectionHead'

export function SidebarBrandArea({ isFullscreen }: { readonly isFullscreen: boolean }) {
  return (
    <>
      <div
        className="drag-region shrink-0 transition-[height] duration-200 ease-out"
        style={{ height: isFullscreen ? 0 : SIDEBAR_LAYOUT.DRAG_REGION_HEIGHT }}
      />
      {/* The 28px lockup stays legible without returning to the old 88px brand block. */}
      <div
        className="drag-region flex shrink-0 items-center px-3.5 pt-2.5 pb-1.5"
        data-qa="sidebar-brand"
      >
        <img
          src={openwaggleLockup}
          alt="OpenWaggle"
          className="no-drag h-7 w-auto object-contain"
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

/** Keep the new-session action aligned with the sidebar's compact row rhythm. */
export function SidebarPrimaryActions({ onNewSession }: { readonly onNewSession: () => void }) {
  return (
    <div className="flex shrink-0 flex-col gap-px px-1.5 pt-0.5 pb-1.5">
      <Button
        variant="row"
        size="none"
        radius="md"
        aria-label="New session"
        data-qa="sidebar-primary-action"
        onClick={onNewSession}
        className="no-drag flex h-7.5 w-full gap-2 px-2 font-normal text-sm text-text-secondary"
      >
        <Edit3 className="size-3.5 shrink-0 text-text-tertiary" />
        <span>New session</span>
        {/* The prototype advertises the shortcut on the row that uses it. */}
        <span
          data-qa="sidebar-kb"
          aria-hidden="true"
          className="ml-auto flex-none rounded border border-border-light bg-bg-tertiary px-1 py-0.5 font-mono text-xs text-text-muted leading-none"
        >
          ⌘N
        </span>
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
        <FolderPlus className="size-3.5" />
      </SidebarIconButton>
      <SidebarProjectSortMenu
        open={sortMenuOpen}
        sortMode={sortMode}
        onSetOpen={onSetSortMenuOpen}
        onSetSortMode={onSetSortMode}
      />
    </SidebarSectionHead>
  )
}

/**
 * The footer, on the prototype's metrics: a top border, a 6px gutter, and a 30px row at 12px.
 *
 * The gear icon is deliberately the app's existing one. The prototype swapped in a different
 * glyph and the maintainer asked to keep this.
 *
 * Usage & Cost (the cross-session view) sits at the row's right edge as its own hit target:
 * the full-width row keeps opening Settings.
 */
export function SidebarSettingsButton({
  onOpenSettings,
  onOpenUsageCost,
}: {
  readonly onOpenSettings: () => void
  readonly onOpenUsageCost: () => void
}) {
  return (
    <div className="no-drag flex shrink-0 items-center gap-0.5 border-t border-border px-1.5 py-1">
      <Button
        variant="row"
        size="none"
        radius="md"
        aria-label="Settings"
        data-qa="sidebar-settings"
        onClick={onOpenSettings}
        className="flex h-7.5 min-w-0 flex-1 gap-2 px-2 font-normal text-xs text-text-tertiary"
      >
        <Settings className="size-3.5 shrink-0" />
        <span>Settings</span>
      </Button>
      {/* ghost, not row: the row variant is w-full and would crowd the Settings label out. */}
      <Button
        variant="ghost"
        size="none"
        radius="md"
        aria-label="Usage & Cost"
        data-qa="sidebar-usage-cost"
        title="Usage & Cost"
        onClick={onOpenUsageCost}
        className="size-7.5"
      >
        <ChartColumn className="size-3.5 shrink-0" />
      </Button>
    </div>
  )
}
