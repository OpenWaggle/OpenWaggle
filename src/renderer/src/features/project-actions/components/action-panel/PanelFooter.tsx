import type { ReactNode } from 'react'
import { Button } from '@/shared/ui/Button'
import { useInlineConfirm } from './useInlineConfirm'

interface PanelFooterProps {
  readonly summary?: ReactNode
  readonly note?: ReactNode
  readonly error?: string | null
  readonly saveLabel: string
  readonly canSave: boolean
  readonly busy: boolean
  /** Cancel discards the draft; with unsaved changes it asks first, inline. */
  readonly dirty: boolean
  readonly actions: { readonly onSave: () => void; readonly onDiscard: () => void }
}

export function PanelFooter(props: PanelFooterProps) {
  const confirm = useInlineConfirm()
  return (
    <div className="grid gap-3 @2xl:grid-cols-[minmax(0,1fr)_auto] @2xl:items-end @2xl:gap-6">
      <div className="grid min-w-0 gap-2">
        {props.summary}
        {props.note ? <p className="text-sm leading-6 text-text-tertiary">{props.note}</p> : null}
        {props.error ? (
          <p role="alert" className="text-sm leading-6 text-error-text">
            {props.error}
          </p>
        ) : null}
      </div>
      {confirm.confirming ? (
        <div className="grid gap-2 @2xl:justify-items-end">
          <p role="alert" className="text-sm text-text-secondary">
            Discard what you have so far?
          </p>
          <div className="grid grid-cols-2 gap-2 @2xl:flex">
            <Button
              ref={confirm.safeChoiceRef}
              variant="secondary"
              size="md"
              onClick={confirm.backOut}
            >
              Keep editing
            </Button>
            <Button variant="danger" size="md" onClick={props.actions.onDiscard}>
              Discard
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end gap-2 @max-md:grid @max-md:grid-cols-2">
          <Button
            ref={confirm.triggerRef}
            variant="secondary"
            size="md"
            align="center"
            disabled={props.busy}
            onClick={() => (props.dirty ? confirm.ask() : props.actions.onDiscard())}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            align="center"
            disabled={!props.canSave || props.busy}
            onClick={props.actions.onSave}
          >
            {props.busy ? 'Saving…' : props.saveLabel}
          </Button>
        </div>
      )}
    </div>
  )
}
