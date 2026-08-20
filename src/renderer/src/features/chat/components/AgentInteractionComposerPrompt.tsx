import type {
  AgentLoopConfirmInteraction,
  AgentLoopEditorInteraction,
  AgentLoopInputInteraction,
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
  AgentLoopSelectInteraction,
} from '@shared/types/agent-loop-interaction'
import { CheckCircle2, CircleSlash, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { Textarea } from '@/shared/ui/Textarea'
import { TextInput } from '@/shared/ui/TextInput'
import { agentLoopInteractionMessage } from '../lib/agent-loop-interaction-view'

type PromptInteraction =
  | AgentLoopConfirmInteraction
  | AgentLoopSelectInteraction
  | AgentLoopInputInteraction
  | AgentLoopEditorInteraction

type SubmitInteractionResponse = (
  interaction: AgentLoopInteraction,
  response: AgentLoopInteractionResponse,
) => Promise<void>

function isPromptInteraction(interaction: AgentLoopInteraction): interaction is PromptInteraction {
  return (
    interaction.kind === 'confirm' ||
    interaction.kind === 'select' ||
    interaction.kind === 'input' ||
    interaction.kind === 'editor'
  )
}

function firstPromptInteraction(interactions: readonly AgentLoopInteraction[]) {
  return interactions.find(isPromptInteraction) ?? null
}

function promptEyebrow(interaction: PromptInteraction) {
  if (interaction.kind === 'confirm') {
    return interaction.purpose === 'authorization'
      ? 'Authorization requested'
      : 'Confirmation requested'
  }

  if (interaction.kind === 'select') {
    return 'Selection requested'
  }

  return 'Input requested'
}

function ConfirmActions({
  interaction,
  busy,
  submit,
}: {
  readonly interaction: AgentLoopConfirmInteraction
  readonly busy: boolean
  readonly submit: (response: AgentLoopInteractionResponse) => void
}) {
  const isAuthorization = interaction.purpose === 'authorization'
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        disabled={busy}
        leftIcon={<CircleSlash className="size-3.5" />}
        onClick={() => submit({ kind: 'confirm', accepted: false })}
      >
        {isAuthorization ? 'Continue without' : 'Cancel'}
      </Button>
      <Button
        disabled={busy}
        leftIcon={<CheckCircle2 className="size-3.5" />}
        variant="accent"
        onClick={() => submit({ kind: 'confirm', accepted: true })}
      >
        {isAuthorization ? 'Allow once' : 'Confirm'}
      </Button>
    </div>
  )
}

function SelectActions({
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
        <Button disabled={busy} onClick={() => submit({ kind: 'select', selected: null })}>
          Cancel
        </Button>
        <Button
          disabled={busy || selected.length === 0}
          variant="accent"
          onClick={() => submit({ kind: 'select', selected })}
        >
          Select
        </Button>
      </div>
    </div>
  )
}

function InputActions({
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
        inputSize="sm"
        placeholder={interaction.placeholder ?? ''}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => submit({ kind: 'input', value: null })}>
          Cancel
        </Button>
        <Button disabled={busy} variant="accent" onClick={() => submit({ kind: 'input', value })}>
          Submit
        </Button>
      </div>
    </div>
  )
}

function EditorActions({
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
        resize="vertical"
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => submit({ kind: 'editor', value: null })}>
          Cancel
        </Button>
        <Button disabled={busy} variant="accent" onClick={() => submit({ kind: 'editor', value })}>
          Submit
        </Button>
      </div>
    </div>
  )
}

function PromptActions({
  interaction,
  busy,
  submit,
}: {
  readonly interaction: PromptInteraction
  readonly busy: boolean
  readonly submit: (response: AgentLoopInteractionResponse) => void
}) {
  if (interaction.kind === 'confirm') {
    return (
      <ConfirmActions
        key={interaction.interactionId}
        interaction={interaction}
        busy={busy}
        submit={submit}
      />
    )
  }

  if (interaction.kind === 'select') {
    return (
      <SelectActions
        key={interaction.interactionId}
        interaction={interaction}
        busy={busy}
        submit={submit}
      />
    )
  }

  if (interaction.kind === 'input') {
    return (
      <InputActions
        key={interaction.interactionId}
        interaction={interaction}
        busy={busy}
        submit={submit}
      />
    )
  }

  return (
    <EditorActions
      key={interaction.interactionId}
      interaction={interaction}
      busy={busy}
      submit={submit}
    />
  )
}

function AgentInteractionComposerPromptBody({
  interaction,
  extraCount,
  onRespond,
}: {
  readonly interaction: PromptInteraction
  readonly extraCount: number
  readonly onRespond: SubmitInteractionResponse
}) {
  const [busyInteractionId, setBusyInteractionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const message = agentLoopInteractionMessage(interaction)
  const isBusy = busyInteractionId === interaction.interactionId

  function submit(response: AgentLoopInteractionResponse) {
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
    <section className="mb-2 overflow-hidden rounded-2xl border border-accent/30 bg-bg-secondary/95 shadow-[0_18px_60px_-42px_rgb(0_0_0/0.95)] backdrop-blur">
      <div className="flex items-start gap-3 p-3">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-accent">
          <ShieldCheck className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-text-muted">
                {promptEyebrow(interaction)}
              </p>
              <h3 className="mt-1 text-[13px] font-semibold text-text-primary">
                {interaction.title}
              </h3>
            </div>
            {extraCount > 0 ? (
              <span className="rounded-full border border-border bg-bg px-2 py-1 text-[11px] text-text-tertiary">
                +{extraCount} queued
              </span>
            ) : null}
          </div>
          {message ? (
            <p className="mt-2 text-[12px] leading-5 text-text-secondary">{message}</p>
          ) : null}
          <div className="mt-3">
            <PromptActions interaction={interaction} busy={isBusy} submit={submit} />
          </div>
          {error ? <p className="mt-2 text-[12px] leading-5 text-error">{error}</p> : null}
        </div>
      </div>
    </section>
  )
}

export function AgentInteractionComposerPrompt({
  interactions,
  onRespond,
}: {
  readonly interactions: readonly AgentLoopInteraction[]
  readonly onRespond: SubmitInteractionResponse
}) {
  const interaction = firstPromptInteraction(interactions)
  if (!interaction) {
    return null
  }

  return (
    <AgentInteractionComposerPromptBody
      key={interaction.interactionId}
      interaction={interaction}
      extraCount={interactions.filter(isPromptInteraction).length - 1}
      onRespond={onRespond}
    />
  )
}
