import { type KeyboardEvent, useRef } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from './Button'

interface SegmentedRadioOption<Value extends string> {
  readonly value: Value
  readonly label: string
}

const KEY_STEPS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
}

/** The option index a navigation key moves to, or null for any other key. */
function targetIndex(key: string, index: number, count: number) {
  const step = KEY_STEPS[key]
  if (step !== undefined) return (index + step + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/**
 * A compact single-choice control following the WAI-ARIA radio group pattern: one tab stop on the
 * checked option, arrow keys move and select, Home/End jump. While `pending` the options stay
 * focusable but inert (`aria-disabled`), so keyboard focus is never dropped mid-save. Selecting
 * the already-checked option still reports it; callers decide whether that saves anything.
 */
export function SegmentedRadioGroup<Value extends string>({
  label,
  options,
  value,
  pending = false,
  onSelect,
}: {
  readonly label: string
  readonly options: readonly SegmentedRadioOption<Value>[]
  readonly value: Value | null
  readonly pending?: boolean
  readonly onSelect: (value: Value) => void
}) {
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const checkedIndex = options.findIndex((option) => option.value === value)
  const tabStop = checkedIndex === -1 ? 0 : checkedIndex

  const select = (index: number) => {
    const option = options[index]
    if (option === undefined || pending) return
    onSelect(option.value)
  }

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const next = targetIndex(event.key, index, options.length)
    if (next === null) return
    event.preventDefault()
    if (pending) return
    optionRefs.current[next]?.focus()
    select(next)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-busy={pending ? true : undefined}
      className="flex shrink-0 rounded-md border border-border bg-bg-secondary p-0.5"
    >
      {options.map((option, index) => {
        const checked = option.value === value
        return (
          <Button
            key={option.value}
            ref={(element) => {
              optionRefs.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={pending ? true : undefined}
            tabIndex={index === tabStop ? 0 : -1}
            size="xs"
            variant="ghost"
            className={cn(
              'h-7 px-2.5 text-xs aria-disabled:cursor-progress',
              checked && 'bg-bg-hover text-text-primary shadow-sm',
            )}
            onClick={() => select(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}
