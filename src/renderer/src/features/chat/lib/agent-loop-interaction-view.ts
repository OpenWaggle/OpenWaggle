import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import type { ExtensionInteractionView } from '@/features/extensions'

export function agentLoopInteractionTitle(interaction: AgentLoopInteraction) {
  return matchBy(interaction, 'kind')
    .with('confirm', 'select', 'input', 'editor', (value) => value.title)
    .with('notify', () => 'Notification')
    .with('custom', () => 'Unsupported custom Pi interaction')
    .exhaustive()
}

export function agentLoopInteractionMessage(interaction: AgentLoopInteraction) {
  return matchBy(interaction, 'kind')
    .with('confirm', 'notify', (value) => value.message)
    .with('custom', () => 'Pi TUI custom interactions are not executed inside OpenWaggle Electron.')
    .with('select', 'input', 'editor', () => undefined)
    .exhaustive()
}

function extensionInteractionActions(
  interaction: AgentLoopInteraction,
): ExtensionInteractionView['actions'] {
  return matchBy(interaction, 'kind')
    .with('confirm', () => [
      { id: 'accept', label: 'Approve', tone: 'primary' as const },
      { id: 'reject', label: 'Decline', tone: 'secondary' as const },
    ])
    .with('select', (value) => value.choices.map((choice) => ({ id: choice, label: choice })))
    .with('input', 'editor', () => [
      { id: 'submit', label: 'Submit', tone: 'primary' as const },
      { id: 'cancel', label: 'Cancel', tone: 'secondary' as const },
    ])
    .with('notify', () => [{ id: 'acknowledge', label: 'Acknowledge', tone: 'primary' as const }])
    .with('custom', () => [])
    .exhaustive()
}

export function toExtensionInteractionView(
  interaction: AgentLoopInteraction,
  state: ExtensionInteractionView['state'] = 'pending',
): ExtensionInteractionView {
  const message = agentLoopInteractionMessage(interaction)
  return {
    id: interaction.interactionId,
    kind: interaction.kind,
    title: agentLoopInteractionTitle(interaction),
    ...(message !== undefined ? { description: message } : {}),
    state,
    actions: extensionInteractionActions(interaction),
  }
}
