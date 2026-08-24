import type { AgentLoopEditorInteraction } from '@shared/types/agent-loop-interaction'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Textarea } from '@/shared/ui/Textarea'
import type { AgentInteractionSubmit } from './agent-interaction-control-types'

export function AgentInteractionEditorControls({
  interaction,
  busy,
  submit,
}: {
  readonly interaction: AgentLoopEditorInteraction
  readonly busy: boolean
  readonly submit: AgentInteractionSubmit
}) {
  const [value, setValue] = useState(interaction.prefill ?? '')
  return (
    <div className="grid gap-2">
      <Textarea
        aria-label={interaction.title}
        disabled={busy}
        value={value}
        resize="vertical"
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          aria-label={`Submit ${interaction.title}`}
          disabled={busy}
          onClick={() => submit({ kind: 'editor', value })}
          variant="accent"
        >
          Submit
        </Button>
        <Button
          aria-label={`Cancel ${interaction.title}`}
          disabled={busy}
          onClick={() => submit({ kind: 'editor', value: null })}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
