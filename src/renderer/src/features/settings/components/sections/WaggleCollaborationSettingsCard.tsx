import type { WaggleStopCondition } from '@shared/types/waggle'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { RangeInput } from '@/shared/ui/RangeInput'

const MIN_TURNS = 4
const MAX_TURNS = 20

interface CollaborationSettingsCardProps {
  stopCondition: WaggleStopCondition
  maxTurns: number
  onStopConditionChange: (stopCondition: WaggleStopCondition) => void
  onMaxTurnsChange: (maxTurns: number) => void
}

export function CollaborationSettingsCard({
  stopCondition,
  maxTurns,
  onStopConditionChange,
  onMaxTurnsChange,
}: CollaborationSettingsCardProps) {
  return (
    <div className="rounded-lg border border-border bg-bg p-5 space-y-4">
      <h3 className="text-sm font-medium text-text-secondary">Collaboration</h3>

      <div className="flex items-center justify-between h-10">
        <span className="text-xs text-text-primary">Stop when</span>
        <StopConditionToggle
          stopCondition={stopCondition}
          onStopConditionChange={onStopConditionChange}
        />
      </div>

      <div className="flex items-center justify-between h-10">
        <span className="text-xs text-text-primary">Max turns</span>
        <MaxTurnsSlider maxTurns={maxTurns} onMaxTurnsChange={onMaxTurnsChange} />
      </div>
    </div>
  )
}

interface StopConditionToggleProps {
  stopCondition: WaggleStopCondition
  onStopConditionChange: (stopCondition: WaggleStopCondition) => void
}

function StopConditionToggle({ stopCondition, onStopConditionChange }: StopConditionToggleProps) {
  return (
    <div className="flex rounded-md border border-border overflow-hidden">
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onStopConditionChange('consensus')}
        className={cn(
          'px-3 py-1.5 text-xs font-medium transition-colors',
          stopCondition === 'consensus'
            ? 'bg-accent/15 text-accent'
            : 'bg-bg text-text-tertiary hover:text-text-secondary',
        )}
      >
        Consensus
      </Button>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onStopConditionChange('user-stop')}
        className={cn(
          'px-3 py-1.5 text-xs font-medium transition-colors border-l border-border',
          stopCondition === 'user-stop'
            ? 'bg-accent/15 text-accent'
            : 'bg-bg text-text-tertiary hover:text-text-secondary',
        )}
      >
        Manual
      </Button>
    </div>
  )
}

interface MaxTurnsSliderProps {
  maxTurns: number
  onMaxTurnsChange: (maxTurns: number) => void
}

function MaxTurnsSlider({ maxTurns, onMaxTurnsChange }: MaxTurnsSliderProps) {
  return (
    <div className="flex items-center gap-3">
      <RangeInput
        min={MIN_TURNS}
        max={MAX_TURNS}
        value={maxTurns}
        onChange={(event) => onMaxTurnsChange(Number(event.target.value))}
        className="w-30 accent-accent"
      />
      <span className="text-xs text-text-secondary w-6 text-right">{maxTurns}</span>
    </div>
  )
}
