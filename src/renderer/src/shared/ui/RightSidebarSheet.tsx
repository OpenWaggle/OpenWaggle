import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from './Button'
import { SHEET_MAX_WIDTH_PX, SHEET_VIEWPORT_WIDTH } from './right-sidebar-layout-sizing'

interface RightSidebarSheetProps {
  readonly children: ReactNode
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

export function RightSidebarSheet({ children, open, onOpenChange }: RightSidebarSheetProps) {
  return (
    <div
      inert={!open}
      className={cn(
        'fixed inset-0 z-50 transition-opacity duration-200 ease-out',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <Button
        variant="unstyled"
        aria-label="Close right sidebar"
        className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
        onClick={() => onOpenChange(false)}
      />
      <aside
        className={cn(
          'absolute inset-y-0 right-0 min-w-0 overflow-hidden border-l border-border bg-diff-bg shadow-2xl shadow-black/30 transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ width: `min(${SHEET_VIEWPORT_WIDTH}, ${String(SHEET_MAX_WIDTH_PX)}px)` }}
      >
        {children}
      </aside>
    </div>
  )
}
