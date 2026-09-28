import { Button } from '@/shared/ui/Button'
import { useInlineConfirm } from './useInlineConfirm'

/**
 * Removal stays quiet and far from Save (ADR 0038). The label fits the case, and an inline
 * confirmation spells out the consequence before anything is removed.
 */
export function RemovalSection(props: {
  readonly label: string
  readonly consequence: string
  readonly confirmLabel: string
  readonly busy: boolean
  readonly onConfirm: () => void
}) {
  const confirm = useInlineConfirm()
  return (
    <section aria-label={props.label} className="border-t border-border pt-5">
      {confirm.confirming ? (
        <div className="grid gap-3">
          <p role="alert" className="text-sm leading-6 text-text-secondary">
            {props.consequence}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={props.busy} onClick={props.onConfirm}>
              {props.confirmLabel}
            </Button>
            <Button
              ref={confirm.safeChoiceRef}
              variant="secondary"
              disabled={props.busy}
              onClick={confirm.backOut}
            >
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <Button
          ref={confirm.triggerRef}
          variant="ghost"
          className="px-0 text-error-text"
          onClick={confirm.ask}
        >
          {props.label}
        </Button>
      )}
    </section>
  )
}
