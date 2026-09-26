import { ChevronDown } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

interface ScrollToBottomButtonProps {
  readonly visible: boolean
  readonly onClick: () => void
}

export function ScrollToBottomButton({ visible, onClick }: ScrollToBottomButtonProps) {
  /*
   * Hidden means gone for input too. The wrapper faded out but the button kept
   * `pointer-events-auto`, so an invisible control over the bottom of the transcript swallowed
   * clicks meant for the rows beneath it and stayed in the tab order.
   */
  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      className={cn(
        'pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2',
        'transition-all duration-200 ease-out motion-reduce:transition-none',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
    >
      <Button
        variant="unstyled"
        type="button"
        onClick={onClick}
        tabIndex={visible ? undefined : -1}
        className={cn(
          visible ? 'pointer-events-auto' : 'pointer-events-none',
          'inline-flex items-center gap-1.5 rounded-full border border-button-border px-2.5 py-1.5',
          'bg-bg-secondary text-xs text-text-secondary shadow-sm',
          'transition-colors hover:border-accent/40 hover:bg-bg-hover hover:text-text-primary',
          'active:border-accent/70 active:bg-[color-mix(in_oklab,var(--color-bg-secondary)_88%,var(--color-accent)_12%)] active:text-text-primary',
          'focus-visible:outline-none',
        )}
        aria-label="Scroll to bottom"
      >
        <ChevronDown className="size-3" />
        <span>Scroll to bottom</span>
      </Button>
    </div>
  )
}
