import { ArrowDownToLine, Ban } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

interface ComposerDropOverlayProps {
  readonly isAtCapacity: boolean
}

export function ComposerDropOverlay({ isAtCapacity }: ComposerDropOverlayProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[var(--radius-panel)] backdrop-blur-[1px]',
        isAtCapacity ? 'bg-red-400/5' : 'bg-accent/8',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg bg-bg-secondary/90 px-4 py-2 shadow-sm border',
          isAtCapacity ? 'border-red-400/30' : 'border-accent/30',
        )}
      >
        {isAtCapacity ? <ComposerDropCapacityMessage /> : <ComposerDropReadyMessage />}
      </div>
    </div>
  )
}

function ComposerDropCapacityMessage() {
  return (
    <>
      <Ban className="size-4 text-red-400" />
      <span className="text-[13px] font-medium text-red-400">Maximum files attached</span>
    </>
  )
}

function ComposerDropReadyMessage() {
  return (
    <>
      <ArrowDownToLine className="size-4 text-accent" />
      <span className="text-[13px] font-medium text-accent">Drop files to attach</span>
    </>
  )
}
