import type { AgentLoopInputInteraction } from '@shared/types/agent-loop-interaction'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import type { AgentInteractionSubmit } from './agent-interaction-control-types'

export function AgentInteractionInputControls({
  interaction,
  busy,
  submit,
}: {
  readonly interaction: AgentLoopInputInteraction
  readonly busy: boolean
  readonly submit: AgentInteractionSubmit
}) {
  const [value, setValue] = useState('')
  return (
    <div className="grid gap-2">
      <TextInput
        disabled={busy}
        placeholder={interaction.placeholder ?? ''}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} variant="accent" onClick={() => submit({ kind: 'input', value })}>
          Submit
        </Button>
        <Button disabled={busy} onClick={() => submit({ kind: 'input', value: null })}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
