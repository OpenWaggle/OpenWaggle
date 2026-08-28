import type { AgentLoopEditorInteraction } from '@shared/types/agent-loop-interaction'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Textarea } from '@/shared/ui/Textarea'
import type { AgentInteractionSubmit } from './agent-interaction-control-types'
import { useChatDisplayText } from './ChatDisplayPathContext'

export function AgentInteractionEditorControls({
  interaction,
  busy,
  submit,
}: {
  readonly interaction: AgentLoopEditorInteraction
  readonly busy: boolean
  readonly submit: AgentInteractionSubmit
}) {
  const displayTitle = useChatDisplayText(interaction.title)
  const originalPrefill = interaction.prefill ?? ''
  const displayPrefill = useChatDisplayText(originalPrefill)
  const [value, setValue] = useState(displayPrefill)
  return (
    <div className="grid gap-2">
      <Textarea
        aria-label={displayTitle}
        disabled={busy}
        value={value}
        resize="vertical"
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          aria-label={`Submit ${displayTitle}`}
          disabled={busy}
          onClick={() =>
            submit({
              kind: 'editor',
              value: value === displayPrefill ? originalPrefill : value,
            })
          }
          variant="accent"
        >
          Submit
        </Button>
        <Button
          aria-label={`Cancel ${displayTitle}`}
          disabled={busy}
          onClick={() => submit({ kind: 'editor', value: null })}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
