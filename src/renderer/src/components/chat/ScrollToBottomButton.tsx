import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

interface ScrollToBottomButtonProps {
  readonly visible: boolean
  readonly onClick: () => void
}

export function ScrollToBottomButton({ visible, onClick }: ScrollToBottomButtonProps) {
  return (
    <div
      className={cn(
        'absolute bottom-3 left-1/2 z-10 -translate-x-1/2',
        'transition-all duration-200 ease-out',
        visible
          ? 'pointer-events-none translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-2 opacity-0',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'pointer-events-auto inline-flex items-center gap-[5px] rounded-full border border-button-border px-2.5 py-1.5',
          'bg-bg-secondary text-[12px] text-text-secondary shadow-sm',
          'transition-colors hover:border-accent/40 hover:bg-bg-hover hover:text-text-primary',
          'active:border-accent/70 active:bg-[color-mix(in_oklab,var(--color-bg-secondary)_88%,var(--color-accent)_12%)] active:text-text-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        )}
        aria-label="Scroll to bottom"
      >
        <ChevronDown className="h-3 w-3" />
        <span>Scroll to bottom</span>
      </button>
    </div>
  )
}
