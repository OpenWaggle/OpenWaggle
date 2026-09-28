import { type KeyboardEvent, type ReactNode, useRef } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

export interface Choice<T extends string> {
  readonly value: T
  readonly title: string
  readonly description: string
  readonly tag?: string
  readonly icon?: ReactNode
}

const NEXT_KEYS = new Set(['ArrowDown', 'ArrowRight'])
const PREVIOUS_KEYS = new Set(['ArrowUp', 'ArrowLeft'])

/**
 * Radio cards with a visible dot, a plain title and one line explaining the consequence. Like a
 * native radio group, the group is one tab stop and the arrow keys move the selection.
 */
export function ChoiceCards<T extends string>(props: {
  readonly label: string
  readonly value: T
  readonly choices: readonly Choice<T>[]
  readonly onChange: (value: T) => void
}) {
  const selectedIndex = Math.max(
    0,
    props.choices.findIndex((choice) => choice.value === props.value),
  )
  const groupRef = useRef<HTMLDivElement>(null)
  function targetIndex(key: string, index: number) {
    const count = props.choices.length
    if (key === 'Home') return 0
    if (key === 'End') return count - 1
    if (NEXT_KEYS.has(key)) return (index + 1) % count
    if (PREVIOUS_KEYS.has(key)) return (index - 1 + count) % count
    return null
  }
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const nextIndex = targetIndex(event.key, index)
    const next = nextIndex === null ? undefined : props.choices[nextIndex]
    if (nextIndex === null || !next) return
    event.preventDefault()
    props.onChange(next.value)
    groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[nextIndex]?.focus()
  }
  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={props.label}
      className="grid grid-cols-1 gap-2.5 @2xl:grid-cols-2"
    >
      {props.choices.map((choice, index) => {
        const selected = choice.value === props.value
        return (
          <Button
            key={choice.value}
            variant="unstyled"
            role="radio"
            aria-checked={selected}
            tabIndex={index === selectedIndex ? 0 : -1}
            className={cn(
              'flex w-full items-start gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-colors @max-md:px-3.5 @max-md:py-3',
              selected ? 'border-accent/45 bg-accent/7' : 'border-border-light hover:bg-bg-hover',
            )}
            onClick={() => props.onChange(choice.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
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
