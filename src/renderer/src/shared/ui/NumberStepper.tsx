import { Minus, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './Button'
import { TextInput } from './TextInput'

const DEFAULT_STEP = 1

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function NumberStepper({
  id,
  label,
  value,
  minimum,
  maximum,
  step = DEFAULT_STEP,
  suffix,
  onValueChange,
}: {
  readonly id?: string
  readonly label: string
  readonly value: number
  readonly minimum: number
  readonly maximum: number
  readonly step?: number
  readonly suffix?: string
  readonly onValueChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const parsedDraft = Number(draft)
  const draftValue = Number.isFinite(parsedDraft) ? parsedDraft : value

  function setClampedValue(nextValue: number) {
    const next = clamp(nextValue, minimum, maximum)
    setDraft(String(next))
    if (next !== value) onValueChange(next)
  }

  function commitInput() {
    const parsed = draft.trim() ? Number(draft) : Number.NaN
    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const next = clamp(parsed, minimum, maximum)
    setDraft(String(next))
    if (next !== value) onValueChange(next)
  }

  function stepDraft(delta: number) {
    const parsed = Number(draft)
    setClampedValue((Number.isFinite(parsed) ? parsed : value) + delta)
  }

  return (
    <fieldset
      className="m-0 inline-flex h-7 w-32 shrink-0 items-stretch overflow-hidden rounded-md border border-border bg-bg-secondary p-0"
      aria-label={`${label} controls`}
    >
      <Button
        variant="unstyled"
        aria-label={`Decrease ${label}`}
        disabled={draftValue <= minimum}
        className="flex w-7 items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text-primary"
        onClick={() => stepDraft(-step)}
      >
        <Minus className="size-3.5" />
      </Button>
      <span className="flex min-w-0 flex-1 items-center border-x border-border bg-bg">
        <TextInput
          id={id}
          type="text"
          role="spinbutton"
          inputMode="numeric"
          aria-label={label}
          aria-valuemin={minimum}
          aria-valuemax={maximum}
          aria-valuenow={value}
          aria-valuetext={suffix ? `${value}${suffix}` : String(value)}
          value={draft}
          variant="transparent"
          inputSize="sm"
          className="h-full min-w-0 flex-1 px-0 text-center font-mono text-xs tabular-nums"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commitInput}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setDraft(String(value))
              event.currentTarget.blur()
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              stepDraft(step)
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              stepDraft(-step)
            }
          }}
        />
        {suffix ? (
          <span className="pr-1.5 font-mono text-xs text-text-muted" aria-hidden="true">
            {suffix}
          </span>
        ) : null}
      </span>
      <Button
        variant="unstyled"
        aria-label={`Increase ${label}`}
        disabled={draftValue >= maximum}
        className="flex w-7 items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text-primary"
        onClick={() => stepDraft(step)}
      >
        <Plus className="size-3.5" />
      </Button>
    </fieldset>
  )
}
