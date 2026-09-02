import type { AgentLoopSelectInteraction } from '@shared/types/agent-loop-interaction'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import type { AgentInteractionSubmit } from './agent-interaction-control-types'
import { useChatDisplayText, useChatDisplayTextFormatter } from './ChatDisplayPathContext'

export function AgentInteractionSelectControls({
  interaction,
  busy,
  submit,
}: {
  readonly interaction: AgentLoopSelectInteraction
  readonly busy: boolean
  readonly submit: AgentInteractionSubmit
}) {
  const [selected, setSelected] = useState(interaction.choices[0] ?? '')
  const displayTitle = useChatDisplayText(interaction.title)
  const formatDisplayText = useChatDisplayTextFormatter()
  return (
    <div className="grid gap-2">
      <Select
        aria-label={displayTitle}
        disabled={busy}
        value={selected}
        onChange={(event) => setSelected(event.currentTarget.value)}
      >
        {interaction.choices.map((choice) => (
          <option key={choice} value={choice}>
            {formatDisplayText(choice)}
          </option>
        ))}
      </Select>
      <div className="flex flex-wrap gap-2">
        <Button
          aria-label={`Select for ${displayTitle}`}
          disabled={busy || selected.length === 0}
          onClick={() => submit({ kind: 'select', selected })}
          variant="accent"
        >
          Select
        </Button>
        <Button
          aria-label={`Cancel ${displayTitle}`}
          disabled={busy}
          onClick={() => submit({ kind: 'select', selected: null })}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
