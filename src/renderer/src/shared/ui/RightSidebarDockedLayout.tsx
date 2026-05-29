import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { sidebarPanelStyle, sidebarShellStyle } from './right-sidebar-layout-sizing'

interface DockedLayoutContent {
  readonly children: ReactNode
  readonly sidebar: ReactNode
}

interface DockedLayoutCaptures {
  readonly captureMain: (node: HTMLDivElement | null) => void
  readonly capturePanel: (node: HTMLDivElement | null) => void
  readonly captureRoot: (node: HTMLDivElement | null) => void
}

interface DockedLayoutShell {
  readonly mainMinWidth: number
  readonly open: boolean
  readonly shouldRenderSidebar: boolean
  readonly width: number
  readonly captureSidebar: (node: HTMLDivElement | null) => void
}

interface RightSidebarDockedLayoutProps {
  readonly captures: DockedLayoutCaptures
  readonly content: DockedLayoutContent
  readonly rail: ReactNode
  readonly shell: DockedLayoutShell
}

export function RightSidebarDockedLayout({
  captures: { captureMain, capturePanel, captureRoot },
  content: { children, sidebar },
  rail,
  shell: { captureSidebar, mainMinWidth, open, shouldRenderSidebar, width },
}: RightSidebarDockedLayoutProps) {
  return (
    <div ref={captureRoot} className="relative flex h-full min-w-0 flex-1 overflow-hidden">
      <div
        ref={captureMain}
        className="min-w-0 flex-1 overflow-hidden"
        data-right-sidebar-main="true"
        tabIndex={-1}
      >
        {children}
      </div>
      {rail}
      <aside
        ref={captureSidebar}
        inert={!open}
        className={cn(
          'relative h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        data-right-sidebar-main-min-width={mainMinWidth}
        data-right-sidebar-preferred-width={width}
        data-right-sidebar-shell="true"
        style={sidebarShellStyle(open, width, mainMinWidth)}
      >
        {shouldRenderSidebar ? (
          <div
            ref={capturePanel}
            className="absolute inset-y-0 right-0 h-full min-w-0 overflow-hidden border-l border-border bg-diff-bg"
            data-right-sidebar-panel="true"
            style={sidebarPanelStyle()}
          >
            {sidebar}
          </div>
        ) : null}
      </aside>
    </div>
  )
}
