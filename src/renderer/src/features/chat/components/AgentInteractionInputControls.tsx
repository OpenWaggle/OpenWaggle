import type { AgentLoopInputInteraction } from '@shared/types/agent-loop-interaction'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import type { AgentInteractionSubmit } from './agent-interaction-control-types'
import { useChatDisplayText } from './ChatDisplayPathContext'

export function AgentInteractionInputControls({
  interaction,
  busy,
  submit,
}: {
  readonly interaction: AgentLoopInputInteraction
  readonly busy: boolean
  readonly submit: AgentInteractionSubmit
}) {
  const displayTitle = useChatDisplayText(interaction.title)
  const displayPlaceholder = useChatDisplayText(interaction.placeholder ?? '')
  const [value, setValue] = useState('')
  return (
    <div className="grid gap-2">
      <TextInput
        aria-label={displayTitle}
        disabled={busy}
        placeholder={displayPlaceholder}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          aria-label={`Submit ${displayTitle}`}
          disabled={busy}
          onClick={() => submit({ kind: 'input', value })}
          variant="accent"
        >
          Submit
        </Button>
        <Button
          aria-label={`Cancel ${displayTitle}`}
          disabled={busy}
          onClick={() => submit({ kind: 'input', value: null })}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
