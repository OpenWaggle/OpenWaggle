import type { ReactNode } from 'react'
import { useWorkspaceTreeResize } from '@/shared/hooks/useWorkspaceTreeResize'
import { cn } from '@/shared/lib/cn'
import { Button } from './Button'

interface WorkspaceTreePanelProps {
  readonly children: ReactNode
  readonly open: boolean
}

/** One right-side navigator shell shared by source review and diff review. */
export function WorkspaceTreePanel({ children, open }: WorkspaceTreePanelProps) {
  if (!open) return null
  return <OpenWorkspaceTreePanel>{children}</OpenWorkspaceTreePanel>
}

function OpenWorkspaceTreePanel({ children }: Pick<WorkspaceTreePanelProps, 'children'>) {
  const resize = useWorkspaceTreeResize()

  return (
    <aside
      aria-label="Workspace navigator"
      className="relative flex h-full max-w-1/2 shrink-0 flex-col border-l border-border bg-bg-secondary/80"
      data-workspace-tree-panel="true"
      style={{ width: `${String(resize.width)}px` }}
    >
      <Button
        variant="unstyled"
        type="button"
        aria-label={`Resize workspace navigator, currently ${String(resize.width)} pixels`}
        title="Drag or use arrow keys to resize"
        onKeyDown={resize.handleKeyDown}
        onLostPointerCapture={resize.handleLostPointerCapture}
        onPointerCancel={resize.handlePointerCancel}
        onPointerDown={resize.handlePointerDown}
        onPointerMove={resize.handlePointerMove}
        onPointerUp={resize.handlePointerUp}
        className={cn(
          'absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize border-0 bg-transparent p-0 transition-colors',
          resize.isResizing ? 'bg-accent/60' : 'hover:bg-accent/40 focus-visible:bg-accent/60',
        )}
      />
      {children}
    </aside>
  )
}
