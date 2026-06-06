import { matchBy } from '@diegogbrisa/ts-match'
import type {
  AgentLoopEditorInteraction,
  AgentLoopInputInteraction,
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
  AgentLoopSelectInteraction,
} from '@shared/types/agent-loop-interaction'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import { MessageSquareWarning } from 'lucide-react'
import { useState } from 'react'
import { ExtensionAgentLoopSurface } from '@/features/extensions'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { Textarea } from '@/shared/ui/Textarea'
import { TextInput } from '@/shared/ui/TextInput'
import {
  agentLoopInteractionMessage,
  agentLoopInteractionTitle,
  toExtensionInteractionView,
} from '../lib/agent-loop-interaction-view'

const EMPTY_EXTENSION_PROJECT_PATHS: readonly string[] = []

interface AgentInteractionsPanelProps {
  readonly interactions: readonly AgentLoopInteraction[]
  readonly extensionRegistry?: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths?: readonly string[]
  onRespond: (
    interaction: AgentLoopInteraction,
    response: AgentLoopInteractionResponse,
  ) => Promise<void>
}

function isPending(busyInteractionId: string | null, interaction: AgentLoopInteraction) {
  return busyInteractionId === interaction.interactionId
}

function InteractionHeader({ interaction }: { readonly interaction: AgentLoopInteraction }) {
  return (
    <div className="flex items-start gap-3">
      <MessageSquareWarning className="mt-0.5 size-4 shrink-0 text-accent" />
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-text-primary">Pi interaction pending</h3>
        <p className="mt-1 text-[12px] leading-5 text-text-tertiary">
          {interaction.kind} · {interaction.source}
        </p>
      </div>
    </div>
  )
}

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

function InteractionControls({
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

export function AgentInteractionsPanel({
  interactions,
  extensionRegistry = null,
  extensionProjectPaths = EMPTY_EXTENSION_PROJECT_PATHS,
  onRespond,
}: AgentInteractionsPanelProps) {
  const [busyInteractionId, setBusyInteractionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (interactions.length === 0) {
    return null
  }

  function submit(interaction: AgentLoopInteraction, response: AgentLoopInteractionResponse) {
    setError(null)
    setBusyInteractionId(interaction.interactionId)
    onRespond(interaction, response)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        setBusyInteractionId(null)
      })
  }

  return (
    <div className="border-t border-border bg-bg-secondary/40 px-6 py-3">
      <div className="mx-auto grid max-w-[720px] gap-3">
        {interactions.map((interaction) => {
          const busy = isPending(busyInteractionId, interaction)
          const message = agentLoopInteractionMessage(interaction)
          return (
            <section
              key={interaction.interactionId}
              className="grid gap-3 rounded-xl border border-accent/25 bg-accent/5 p-3"
            >
              <InteractionHeader interaction={interaction} />
              <ExtensionAgentLoopSurface
                fallback={null}
                input={{
                  surface: 'interaction',
                  interaction: toExtensionInteractionView(interaction),
                }}
                projectPaths={extensionProjectPaths}
                registry={extensionRegistry}
              />
              <div>
                <div className="text-[13px] font-medium text-text-primary">
                  {agentLoopInteractionTitle(interaction)}
                </div>
                {message ? (
                  <p className="mt-1 text-[12px] leading-5 text-text-tertiary">{message}</p>
                ) : null}
              </div>
              <InteractionControls
                interaction={interaction}
                busy={busy}
                submit={(response) => submit(interaction, response)}
              />
            </section>
          )
        })}
        {error ? <p className="text-[12px] text-error">{error}</p> : null}
      </div>
    </div>
  )
}
