import type { AgentLoopSelectInteraction } from '@shared/types/agent-loop-interaction'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import type { AgentInteractionSubmit } from './agent-interaction-control-types'

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
  return (
    <div className="grid gap-2">
      <Select
        disabled={busy}
        value={selected}
        onChange={(event) => setSelected(event.currentTarget.value)}
      >
        {interaction.choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </Select>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || selected.length === 0}
          variant="accent"
          onClick={() => submit({ kind: 'select', selected })}
        >
          Select
        </Button>
        <Button disabled={busy} onClick={() => submit({ kind: 'select', selected: null })}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
