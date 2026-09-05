import { Minus, Plus } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Button } from './Button'
import { TextInput } from './TextInput'

const DEFAULT_STEP = 1

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

interface NumberStepperProps {
  readonly id?: string
  readonly label: string
  readonly value: number
  readonly minimum: number
  readonly maximum: number
  readonly step?: number
  readonly suffix?: string
  readonly disabled?: boolean
  readonly onValueChange: (value: number) => void
}

function StepperButton({
  label,
  busy,
  boundary,
  onStep,
  children,
}: {
  readonly label: string
  readonly busy: boolean
  readonly boundary: boolean
  readonly onStep: () => void
  readonly children: ReactNode
}) {
  return (
    <Button
      variant="unstyled"
      aria-label={label}
      aria-disabled={busy || boundary}
      disabled={boundary}
      className="flex w-7 items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      onMouseDown={(event) => event.preventDefault()}
      onClick={busy ? undefined : onStep}
    >
      {children}
    </Button>
  )
}

function useNumberStepperDraft(value: number, disabled: boolean) {
  const [state, setState] = useState({ sourceValue: value, text: String(value) })
  const resetOnEnableRef = useRef(false)
  useEffect(() => {
    if (disabled) resetOnEnableRef.current = true
  }, [disabled])
  const isCurrent = state.sourceValue === value && !(resetOnEnableRef.current && !disabled)
  const draft = isCurrent ? state.text : String(value)
  const setDraft = (text: string) => {
    resetOnEnableRef.current = false
    setState({ sourceValue: value, text })
  }
  return [draft, setDraft] as const
}

export function NumberStepper({
  id,
  label,
  value,
  minimum,
  maximum,
  step = DEFAULT_STEP,
  suffix,
  disabled = false,
  onValueChange,
}: NumberStepperProps) {
  const [draft, setDraft] = useNumberStepperDraft(value, disabled)
  const suppressNextBlurRef = useRef(false)
  const parsedDraft = draft.trim() ? Number(draft) : Number.NaN
  const draftValue = Number.isFinite(parsedDraft) ? parsedDraft : value

  function normalizeValue(nextValue: number) {
    const steppedValue = minimum + Math.round((nextValue - minimum) / step) * step
    return clamp(steppedValue, minimum, maximum)
  }

  function setClampedValue(nextValue: number) {
    const next = normalizeValue(nextValue)
    setDraft(String(next))
    if (next !== value) onValueChange(next)
  }

  function commitInput() {
    const parsed = draft.trim() ? Number(draft) : Number.NaN
    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const next = normalizeValue(parsed)
    setDraft(String(next))
    if (next !== value) onValueChange(next)
  }

  function stepDraft(delta: number) {
    setClampedValue(draftValue + delta)
  }

  return (
    <fieldset
      className="m-0 inline-flex h-7 w-32 shrink-0 items-stretch overflow-hidden rounded-md border border-border bg-bg-secondary p-0"
      aria-label={`${label} controls`}
      aria-busy={disabled}
    >
      <StepperButton
        label={`Decrease ${label}`}
        busy={disabled}
        boundary={draftValue <= minimum}
        onStep={() => stepDraft(-step)}
      >
        <Minus className="size-3.5" />
      </StepperButton>
      <span className="flex min-w-0 flex-1 items-center border-x border-border bg-bg">
        <TextInput
          id={id}
          type="text"
          role="spinbutton"
          inputMode="numeric"
          aria-label={label}
          aria-valuemin={minimum}
          aria-valuemax={maximum}
          aria-valuenow={draftValue}
          aria-valuetext={suffix ? `${draftValue}${suffix}` : String(draftValue)}
          aria-disabled={disabled}
          value={draft}
          readOnly={disabled}
          variant="transparent"
          inputSize="sm"
          className="h-full min-w-0 flex-1 px-0 text-center font-mono text-xs tabular-nums"
          onChange={(event) => {
            if (!disabled) setDraft(event.currentTarget.value)
          }}
          onBlur={() => {
            if (disabled) return
            if (suppressNextBlurRef.current) {
              suppressNextBlurRef.current = false
              return
            }
            commitInput()
          }}
          onKeyDown={(event) => {
            if (disabled) {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') event.preventDefault()
              return
            }
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              suppressNextBlurRef.current = true
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
      <StepperButton
        label={`Increase ${label}`}
        busy={disabled}
        boundary={draftValue >= maximum}
        onStep={() => stepDraft(step)}
      >
        <Plus className="size-3.5" />
      </StepperButton>
    </fieldset>
  )
}
