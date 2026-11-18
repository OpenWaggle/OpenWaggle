import { randomUUID } from 'node:crypto'
import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationCommand,
} from '@shared/types/session-control'
import { sanitizeTerminalText } from './terminal-text'

export function sessionControlPayload(command: SessionControlMutationCommand) {
  return {
    contract: 'session-control-v2',
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      command,
    },
  } satisfies LocalSessionCommandPayload
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

/** A choice printed as it is only when the terminal shows it unchanged on one line. */
function isPrintableChoice(choice: string) {
  return choice.length > 0 && !/[\t\n]/.test(choice) && sanitizeTerminalText(choice) === choice
}

/** How to answer a question from another terminal, when it has a CLI response form. */
export function respondCommandHint(
  interaction: AgentLoopInteraction,
  platform: NodeJS.Platform = process.platform,
) {
  const target = `${interaction.sessionId} ${interaction.runId} ${interaction.interactionId}`
  const respond = `openwaggle hive request-respond ${target}`
  return matchBy(interaction, 'kind')
    .with('confirm', (confirm) =>
      isAuthorizationConfirmation(confirm)
        ? `openwaggle hive approval-respond ${target} allow`
        : `${respond} --confirm`,
    )
    .with('select', (select) => {
      const choice = select.choices[0] ?? ''
      // Windows shells quote differently, and a choice could break out of any one form, so the
      // choice is shown on its own line to be quoted for the shell in use.
      if (platform !== 'win32' && isPrintableChoice(choice)) {
        // A value that starts with -- would read as an option, so it is attached with =.
        const separator = choice.startsWith('--') ? '=' : ' '
        return `${respond} --choice${separator}${shellSingleQuoted(choice)}`
      }
      const which = isPrintableChoice(choice) ? choice : 'one of the choices listed above'
      return `${respond} --choice CHOICE\n  where CHOICE is ${which}`
    })
    .with('input', 'editor', () => `${respond} --text ANSWER`)
    .with('notify', 'custom', () => undefined)
    .exhaustive()
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
