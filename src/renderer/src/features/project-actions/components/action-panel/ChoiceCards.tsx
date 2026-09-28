import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

export interface Choice<T extends string> {
  readonly value: T
  readonly title: string
  readonly description: string
  readonly tag?: string
  readonly icon?: ReactNode
}

/** Radio cards with a visible dot, a plain title and one line explaining the consequence. */
export function ChoiceCards<T extends string>(props: {
  readonly label: string
  readonly value: T
  readonly choices: readonly Choice<T>[]
  readonly onChange: (value: T) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      className="grid grid-cols-1 gap-2.5 @2xl:grid-cols-2"
    >
      {props.choices.map((choice) => {
        const selected = choice.value === props.value
        return (
          <Button
            key={choice.value}
            variant="unstyled"
            role="radio"
            aria-checked={selected}
            className={cn(
              'flex w-full items-start gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-colors @max-md:px-3.5 @max-md:py-3',
              selected ? 'border-accent/45 bg-accent/7' : 'border-border-light hover:bg-bg-hover',
            )}
            onClick={() => props.onChange(choice.value)}
          >
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full border-2',
                selected ? 'border-accent' : 'border-text-tertiary',
              )}
            >
              {selected ? <span className="size-2 rounded-full bg-accent" /> : null}
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                {choice.icon}
                {choice.title}
                {choice.tag ? (
                  <span className="rounded-full bg-bg-active px-2 py-0.5 text-xs font-medium text-text-secondary">
                    {choice.tag}
                  </span>
                ) : null}
              </span>
              <span className="mt-1 block text-sm leading-6 text-text-tertiary">
                {choice.description}
              </span>
            </span>
          </Button>
        )
      })}
    </div>
  )
}
