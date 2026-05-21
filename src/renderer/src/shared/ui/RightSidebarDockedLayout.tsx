import type { ReactNode, RefObject } from 'react'
import { cn } from '@/shared/lib/cn'
import { RightSidebarResizeRail } from './RightSidebarResizeRail'
import { sidebarPanelStyle, sidebarShellStyle } from './right-sidebar-layout-sizing'
import type {
  ResizeRailActions,
  ResizeRailBounds,
  ResizeRailStateInput,
  WidthAcceptanceContext,
} from './right-sidebar-layout-types'

interface DockedLayoutContent {
  readonly children: ReactNode
  readonly sidebar: ReactNode
}

interface DockedLayoutRefs {
  readonly mainRef: RefObject<HTMLDivElement | null>
  readonly panelRef: RefObject<HTMLDivElement | null>
  readonly rootRef: RefObject<HTMLDivElement | null>
  readonly sidebarRef: RefObject<HTMLDivElement | null>
  readonly widthRef: RefObject<number>
}

interface DockedLayoutShell {
  readonly mainMinWidth: number
  readonly open: boolean
  readonly shouldRenderSidebar: boolean
  readonly width: number
  readonly captureSidebar: (node: HTMLDivElement | null) => void
}

interface DockedLayoutRail {
  readonly actions: ResizeRailActions
  readonly bounds: ResizeRailBounds
  readonly state: ResizeRailStateInput
  readonly shouldAcceptWidth?: (context: WidthAcceptanceContext) => boolean
}

interface RightSidebarDockedLayoutProps {
  readonly content: DockedLayoutContent
  readonly refs: DockedLayoutRefs
  readonly rail: DockedLayoutRail
  readonly shell: DockedLayoutShell
}

export function RightSidebarDockedLayout({
  content,
  refs,
  rail,
  shell,
}: RightSidebarDockedLayoutProps) {
  return (
    <div ref={refs.rootRef} className="relative flex h-full min-w-0 flex-1 overflow-hidden">
      <div
        ref={refs.mainRef}
        className="min-w-0 flex-1 overflow-hidden"
        data-right-sidebar-main="true"
        tabIndex={-1}
      >
        {content.children}
      </div>
      <RightSidebarResizeRail
        actions={rail.actions}
        bounds={rail.bounds}
        refs={{
          panelRef: refs.panelRef,
          rootRef: refs.rootRef,
          sidebarRef: refs.sidebarRef,
          widthRef: refs.widthRef,
        }}
        state={rail.state}
        shouldAcceptWidth={rail.shouldAcceptWidth}
      />
      <aside
        ref={shell.captureSidebar}
        inert={!shell.open}
        className={cn(
          'relative h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
          shell.open ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        data-right-sidebar-main-min-width={shell.mainMinWidth}
        data-right-sidebar-preferred-width={shell.width}
        data-right-sidebar-shell="true"
        style={sidebarShellStyle(shell.open, shell.width, shell.mainMinWidth)}
      >
        {shell.shouldRenderSidebar ? (
          <div
            ref={refs.panelRef}
            className="absolute inset-y-0 right-0 h-full min-w-0 overflow-hidden border-l border-border bg-diff-bg"
            data-right-sidebar-panel="true"
            style={sidebarPanelStyle()}
          >
            {content.sidebar}
          </div>
        ) : null}
      </aside>
    </div>
  )
}
