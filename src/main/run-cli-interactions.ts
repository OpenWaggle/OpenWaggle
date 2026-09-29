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

const FIRST_PRINTABLE_ASCII = 0x20
const LAST_PRINTABLE_ASCII = 0x7e
const HEX_RADIX = 16
const JSON_UNICODE_ESCAPE_DIGITS = 4

/**
 * JSON with every character outside printable ASCII escaped as `\uXXXX`, so the example
 * survives the terminal sanitizer unchanged and still parses when pasted.
 */
function asciiJson(value: string) {
  const json = JSON.stringify(value)
  let result = ''
  for (let index = 0; index < json.length; index += 1) {
    const code = json.charCodeAt(index)
    const printable = code >= FIRST_PRINTABLE_ASCII && code <= LAST_PRINTABLE_ASCII
    result += printable
      ? json[index]
      : `\\u${code.toString(HEX_RADIX).padStart(JSON_UNICODE_ESCAPE_DIGITS, '0')}`
  }
  return result
}

function exampleResponse(interaction: AgentLoopInteraction) {
  return matchBy(interaction, 'kind')
    .with('confirm', () => '{"kind":"confirm","accepted":true}')
    .with(
      'select',
      (select) => `{"kind":"select","selected":${asciiJson(select.choices[0] ?? '')}}`,
    )
    .with('input', () => '{"kind":"input","value":"..."}')
    .with('editor', () => '{"kind":"editor","value":"..."}')
    .with('notify', 'custom', () => undefined)
    .exhaustive()
}

/** How to answer a question from another terminal, when it has a CLI response form. */
export function respondCommandHint(
  interaction: AgentLoopInteraction,
  platform: NodeJS.Platform = process.platform,
) {
  const example = exampleResponse(interaction)
  if (!example) return undefined
  const approve = isAuthorizationConfirmation(interaction) ? ' --approve' : ''
  const command = `openwaggle sessions requests respond ${interaction.sessionId} ${interaction.runId} ${interaction.interactionId}`
  // Windows shells quote differently, and a choice could break out of any one form, so the
  // response is shown on its own line to be quoted for the shell in use.
  if (platform === 'win32') {
    return `${command} --response-json <response>${approve}\n  where <response> is ${example}`
  }
  return `${command} --response-json ${shellSingleQuoted(example)}${approve}`
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
