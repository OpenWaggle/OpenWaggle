import { matchBy } from '@diegogbrisa/ts-match'
import type {
  AgentLoopEditorInteraction,
  AgentLoopInputInteraction,
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
  AgentLoopSelectInteraction,
} from '@shared/types/agent-loop-interaction'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { Textarea } from '@/shared/ui/Textarea'
import { TextInput } from '@/shared/ui/TextInput'

function ConfirmControls({
  interaction,
  busy,
  submit,
}: {
  readonly interaction: AgentLoopInteraction
  readonly busy: boolean
  readonly submit: (response: AgentLoopInteractionResponse) => void
}) {
  if (interaction.kind !== 'confirm') return null
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        disabled={busy}
        variant="accent"
        onClick={() => submit({ kind: 'confirm', accepted: true })}
      >
        Approve
      </Button>
      <Button disabled={busy} onClick={() => submit({ kind: 'confirm', accepted: false })}>
        Decline
      </Button>
    </div>
  )
}

function SelectControls({
  interaction,
  busy,
  submit,
}: {
  readonly interaction: AgentLoopSelectInteraction
  readonly busy: boolean
  readonly submit: (response: AgentLoopInteractionResponse) => void
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

function InputControls({
  interaction,
  busy,
  submit,
}: {
  readonly interaction: AgentLoopInputInteraction
  readonly busy: boolean
  readonly submit: (response: AgentLoopInteractionResponse) => void
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

function EditorControls({
  interaction,
  busy,
  submit,
}: {
  readonly interaction: AgentLoopEditorInteraction
  readonly busy: boolean
  readonly submit: (response: AgentLoopInteractionResponse) => void
}) {
  const [value, setValue] = useState(interaction.prefill ?? '')
  return (
    <div className="grid gap-2">
      <Textarea
        disabled={busy}
        value={value}
        resize="vertical"
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} variant="accent" onClick={() => submit({ kind: 'editor', value })}>
          Submit
        </Button>
        <Button disabled={busy} onClick={() => submit({ kind: 'editor', value: null })}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function AgentInteractionControls({
  interaction,
  busy,
  submit,
}: {
  readonly interaction: AgentLoopInteraction
  readonly busy: boolean
  readonly submit: (response: AgentLoopInteractionResponse) => void
}) {
  return matchBy(interaction, 'kind')
    .with('confirm', (value) => <ConfirmControls interaction={value} busy={busy} submit={submit} />)
    .with('select', (value) => <SelectControls interaction={value} busy={busy} submit={submit} />)
    .with('input', (value) => <InputControls interaction={value} busy={busy} submit={submit} />)
    .with('editor', (value) => <EditorControls interaction={value} busy={busy} submit={submit} />)
    .with('notify', 'custom', () => null)
    .exhaustive()
}
