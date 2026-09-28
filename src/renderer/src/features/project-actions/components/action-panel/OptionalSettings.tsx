import type { ReactNode } from 'react'
import { useId } from 'react'
import { Button } from '@/shared/ui/Button'

/**
 * A quiet optional setting: its question and current answer in plain words, expanded in place
 * with Change (ADR 0038). Only one row is open at a time, controlled by the parent list.
 */
export function OptionalSettingRow(props: {
  readonly question: string
  readonly answer: string
  readonly open: boolean
  readonly onToggle: () => void
  readonly children: ReactNode
}) {
  const bodyId = useId()
  return (
    <div className="border-b border-border last:border-b-0">
      <Button
        variant="unstyled"
        aria-expanded={props.open}
        aria-controls={bodyId}
        className="group flex w-full items-center gap-3 px-1 py-4 text-left"
        onClick={props.onToggle}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-text-secondary group-hover:text-text-primary">
            {props.question}
          </span>
          <span className="mt-0.5 block text-sm text-text-tertiary">{props.answer}</span>
        </span>
        <span className="shrink-0 text-sm text-accent">{props.open ? 'Done' : 'Change'}</span>
      </Button>
      {props.open ? (
        <div id={bodyId} className="grid gap-3 px-1 pb-5">
          {props.children}
        </div>
      ) : null}
    </div>
  )
}

export function OptionalSettings(props: { readonly children: ReactNode }) {
  return (
    <section aria-label="Optional settings" className="grid gap-1 border-t border-border pt-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold text-text-primary">Optional settings</h3>
        <span className="text-sm text-text-tertiary">The defaults work for most actions</span>
      </div>
      <div>{props.children}</div>
    </section>
  )
}
