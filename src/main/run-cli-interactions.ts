import { randomUUID } from 'node:crypto'
import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationCommand,
} from '@shared/types/session-control'

export function sessionControlPayload(
  command: SessionControlMutationCommand,
): LocalSessionCommandPayload {
  return {
    contract: 'session-control-v2',
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      command,
    },
  }
}

export function isAuthorizationConfirmation(interaction: AgentLoopInteraction) {
  return interaction.kind === 'confirm' && interaction.purpose === 'authorization'
}

/** A one-line description of what the agent is asking. */
export function describeInteraction(interaction: AgentLoopInteraction) {
  return matchBy(interaction, 'kind')
    .with('confirm', (confirm) => `${confirm.title}: ${confirm.message}`)
    .with('select', (select) => `${select.title} (${select.choices.join(', ')})`)
    .with('input', 'editor', (question) => question.title)
    .with('notify', (notice) => notice.message)
    .with('custom', (custom) => custom.customType)
    .exhaustive()
}

function exampleResponse(interaction: AgentLoopInteraction) {
  return matchBy(interaction, 'kind')
    .with('confirm', () => '{"kind":"confirm","accepted":true}')
    .with(
      'select',
      (select) => `{"kind":"select","selected":${JSON.stringify(select.choices[0] ?? '')}}`,
    )
    .with('input', () => '{"kind":"input","value":"..."}')
    .with('editor', () => '{"kind":"editor","value":"..."}')
    .with('notify', 'custom', () => undefined)
    .exhaustive()
}

/** How to answer a question from another terminal, when it has a CLI response form. */
export function respondCommandHint(interaction: AgentLoopInteraction) {
  const example = exampleResponse(interaction)
  if (!example) return undefined
  const approve = isAuthorizationConfirmation(interaction) ? ' --approve' : ''
  return `openwaggle sessions requests respond ${interaction.sessionId} ${interaction.runId} ${interaction.interactionId} --response-json ${shellSingleQuoted(example)}${approve}`
}

/** POSIX single quoting, so an agent-chosen choice cannot break out of the pasted command. */
function shellSingleQuoted(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** Interprets a typed answer to an "Allow? [y/N]" prompt; anything but yes declines. */
export function isAffirmativeAnswer(answer: string) {
  return /^\s*y(es)?\s*$/i.test(answer)
}

/** Ctrl-C pressed while a question was on screen; readline consumes it before any signal. */
export class PromptInterruptedError extends Error {
  constructor() {
    super('The question was interrupted.')
    this.name = 'PromptInterruptedError'
  }
}
