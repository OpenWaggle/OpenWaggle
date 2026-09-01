import { Button } from '@/shared/ui/Button'

export interface SettingsChoice<TValue extends number | string> {
  readonly value: TValue
  readonly label: string
  readonly description: string
}

interface SettingsChoiceGroupProps<TValue extends number | string> {
  readonly choices: readonly SettingsChoice<TValue>[]
  readonly value: TValue
  readonly disabled?: boolean
  readonly onSelect: (value: TValue) => void
}

const ROW_CLASS =
  'flex w-full items-center justify-between border-b border-border px-5 py-3 text-left last:border-b-0 hover:bg-bg-hover'

function RadioDot({ active }: { readonly active: boolean }) {
  return (
    <div
      className={`size-3 shrink-0 rounded-full border ${active ? 'border-accent bg-accent' : 'border-border-light'}`}
    />
  )
}

/** Shared selectable rows used by settings sections with a small, fixed set of choices. */
export function SettingsChoiceGroup<TValue extends number | string>({
  choices,
  value,
  disabled = false,
  onSelect,
}: SettingsChoiceGroupProps<TValue>) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg">
      {choices.map((choice) => {
        const isSelected = value === choice.value
        return (
          <Button
            variant="unstyled"
            type="button"
            key={choice.value}
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => onSelect(choice.value)}
            className={ROW_CLASS}
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-text-primary">{choice.label}</span>
              <span className="text-xs text-text-tertiary">{choice.description}</span>
            </div>
            <RadioDot active={isSelected} />
          </Button>
        )
      })}
    </div>
  )
}
