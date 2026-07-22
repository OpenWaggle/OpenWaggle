import { matchBy } from '@diegogbrisa/ts-match'
import type {
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import { AgentInteractionConfirmControls } from './AgentInteractionConfirmControls'
import { AgentInteractionEditorControls } from './AgentInteractionEditorControls'
import { AgentInteractionInputControls } from './AgentInteractionInputControls'
import { AgentInteractionSelectControls } from './AgentInteractionSelectControls'

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
    .with('confirm', () => <AgentInteractionConfirmControls busy={busy} submit={submit} />)
    .with('select', (value) => (
      <AgentInteractionSelectControls interaction={value} busy={busy} submit={submit} />
    ))
    .with('input', (value) => (
      <AgentInteractionInputControls interaction={value} busy={busy} submit={submit} />
    ))
    .with('editor', (value) => (
      <AgentInteractionEditorControls interaction={value} busy={busy} submit={submit} />
    ))
    .with('notify', 'custom', () => null)
    .exhaustive()
}
