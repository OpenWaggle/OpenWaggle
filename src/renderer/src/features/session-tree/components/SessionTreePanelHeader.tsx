import { ListTree, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import type { SessionTreePanelProps } from '../model'

export function SessionTreePanelHeader({ onClose }: SessionTreePanelProps) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
      <div className="flex min-w-0 items-center gap-2">
        <ListTree className="size-4 shrink-0 text-text-tertiary" />
        <h2 className="truncate text-[13px] font-semibold text-text-primary">Session Tree</h2>
      </div>
      <Button
        variant="unstyled"
        type="button"
        aria-label="Close Session Tree"
        onClick={onClose}
        className="rounded p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
      >
        <X className="size-4" />
      </Button>
    </div>
  )
}
