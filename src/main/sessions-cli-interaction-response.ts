import { match, matchBy } from '@diegogbrisa/ts-match'
import { SESSION_HOST_REFUSAL_KINDS } from '@shared/domain/session-host-refusals'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { agentLoopResponseSchema } from '@shared/schemas/agent-loop-interaction'
import { AGENT_AUTHORIZATION_DECISION_SCOPES } from '@shared/types/agent-authorization-grants'
import type {
  AgentLoopConfirmResponse,
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import type { JsonValue } from '@shared/types/json'
import { CliError } from './cli-error'
import { CommandCliUsageError } from './command-cli-option-contract'
import { option, type ParsedArguments } from './mcp-cli-arguments'

const APPROVAL_DECISION_POSITIONAL = 3

/** `approval-respond <session> <run> <request> allow|deny [--for once|session|project]`. */
export function approvalResponse(arguments_: ParsedArguments): AgentLoopConfirmResponse {
  const decision = arguments_.positionals[APPROVAL_DECISION_POSITIONAL]
  if (decision !== 'allow' && decision !== 'deny') {
    throw new CommandCliUsageError('approval-respond takes allow or deny after the request ID.')
  }
  const reach = option(arguments_, 'for')
  if (reach === undefined) return { kind: 'confirm', accepted: decision === 'allow' }
  const scope = AGENT_AUTHORIZATION_DECISION_SCOPES.find((candidate) => candidate === reach)
  if (!scope) throw new CommandCliUsageError('--for must be once, session or project.')
  if (decision === 'deny') throw new CommandCliUsageError('--for applies only to allow.')
  return { kind: 'confirm', accepted: true, scope }
}

/**
 * The response a respond command sends: the structured one an MCP caller or the CLI's request read
 * supplied, or the approval's `allow|deny`.
 */
export function interactionResponseFromInput(
  command: 'request-respond' | 'approval-respond',
  arguments_: ParsedArguments,
  structured: unknown,
) {
  if (structured !== undefined)
    return decodeUnknownExactOrThrow(agentLoopResponseSchema, structured)
  if (command === 'approval-respond') return approvalResponse(arguments_)
  // The CLI reads the pending request to pick the response kind (sessions-cli-host-input.ts).
  throw new Error('request-respond needs the response for the pending request.')
}

/** The answer a `request-respond` command line gives, before it knows the request's kind. */
export type InteractionAnswer =
  | { readonly kind: 'choice'; readonly choice: string }
  | { readonly kind: 'text'; readonly text: string; readonly option: string }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'decline' }
  | { readonly kind: 'acknowledge' }
  | { readonly kind: 'dismiss' }
  | { readonly kind: 'value'; readonly value: JsonValue }

const ANSWER_OPTIONS = [
  'choice',
  'text',
  'stdin',
  'input-file',
  'confirm',
  'decline',
  'acknowledge',
  'dismiss',
  'value-file',
] as const

const ANSWER_OPTION_LIST =
  '--choice, --text, --stdin, --input-file, --confirm, --decline, --acknowledge, --dismiss or --value-file'

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value === 'object') return Object.values(value).every(isJsonValue)
  return false
}

function parseValueFile(text: string): JsonValue {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw new CommandCliUsageError('--value-file must contain one JSON value.', { cause })
  }
  if (!isJsonValue(value)) throw new CommandCliUsageError('--value-file must contain JSON.')
  return value
}

/** Reads the one answer option of `request-respond`, including the file or stdin it names. */
export async function readInteractionAnswer(
  arguments_: ParsedArguments,
  read: {
    readonly stdin: () => Promise<string>
    readonly file: (filePath: string) => Promise<string>
  },
): Promise<InteractionAnswer> {
  const given = ANSWER_OPTIONS.filter((name) => arguments_.options.has(name))
  const [answer] = given
  if (given.length !== 1 || answer === undefined) {
    throw new CommandCliUsageError(`Answer with exactly one of ${ANSWER_OPTION_LIST}.`)
  }
  const value = option(arguments_, answer) ?? ''
  return match(answer)
    .with('choice', () => ({ kind: 'choice' as const, choice: value }))
    .with('text', () => ({ kind: 'text' as const, text: value, option: '--text' }))
    .with('stdin', async () => ({
      kind: 'text' as const,
      text: await read.stdin(),
      option: '--stdin',
    }))
    .with('input-file', async () => ({
      kind: 'text' as const,
      text: await read.file(value),
      option: '--input-file',
    }))
    .with('confirm', 'decline', 'acknowledge', 'dismiss', (flag) => ({ kind: flag }))
    .with('value-file', async () => ({
      kind: 'value' as const,
      value: parseValueFile(value === '-' ? await read.stdin() : await read.file(value)),
    }))
    .exhaustive()
}

function answerOption(answer: InteractionAnswer) {
  return matchBy(answer, 'kind')
    .with('choice', () => '--choice')
    .with('text', (text) => text.option)
    .with('confirm', () => '--confirm')
    .with('decline', () => '--decline')
    .with('acknowledge', () => '--acknowledge')
    .with('dismiss', () => '--dismiss')
    .with('value', () => '--value-file')
    .exhaustive()
}

function mismatch(interaction: AgentLoopInteraction, answer: InteractionAnswer, fits: string) {
  return new CommandCliUsageError(
    `Request ${interaction.interactionId} is a ${interaction.kind} request, which ${answerOption(answer)} cannot answer. Answer it with ${fits}.`,
  )
}

function confirmResponse(
  interaction: Extract<AgentLoopInteraction, { readonly kind: 'confirm' }>,
  answer: InteractionAnswer,
): AgentLoopInteractionResponse {
  if (interaction.purpose === 'authorization') {
    // request-respond asks the Session Host first (approvalRequestError); this is the Host's
    // answer to a caller that may answer it, should one get here without asking.
    const code = 'interaction-mismatch'
    throw new CliError(
      SESSION_HOST_REFUSAL_KINDS[code],
      `Request ${interaction.interactionId} is an approval request. Answer it with 'openwaggle hive approval-respond ${interaction.sessionId} ${interaction.runId} ${interaction.interactionId} allow|deny'.`,
      { code },
    )
  }
  if (answer.kind === 'confirm') return { kind: 'confirm', accepted: true }
  // Dismissing a confirmation declines it, as closing the dialog does.
  if (answer.kind === 'decline' || answer.kind === 'dismiss') {
    return { kind: 'confirm', accepted: false }
  }
  throw mismatch(interaction, answer, '--confirm or --decline')
}

/**
 * The response an answer gives when only the answer option names the kind: what a retry with
 * `--idempotency-key` sends once the request is no longer pending, so the Session Host can replay
 * the answer it recorded. `--text`, `--stdin`, `--input-file` and `--dismiss` fit more than one
 * kind, so they give none.
 */
export function interactionResponseFromAnswerAlone(
  answer: InteractionAnswer,
): AgentLoopInteractionResponse | undefined {
  return matchBy(answer, 'kind')
    .with('choice', (choice): AgentLoopInteractionResponse => ({
      kind: 'select',
      selected: choice.choice,
    }))
    .with('confirm', (): AgentLoopInteractionResponse => ({ kind: 'confirm', accepted: true }))
    .with('decline', (): AgentLoopInteractionResponse => ({ kind: 'confirm', accepted: false }))
    .with('acknowledge', (): AgentLoopInteractionResponse => ({
      kind: 'notify',
      acknowledged: true,
    }))
    .with('value', (value): AgentLoopInteractionResponse => ({
      kind: 'custom',
      value: value.value,
    }))
    .with('text', 'dismiss', () => undefined)
    .exhaustive()
}

/** A `--choice` that is one of the select request's choices; any other is a usage error. */
function listedChoice(select: { readonly choices: readonly string[] }, choice: string) {
  if (select.choices.includes(choice)) return choice
  throw new CommandCliUsageError(
    `--choice ${JSON.stringify(choice)} is not one of this request's choices: ${select.choices.map((item) => JSON.stringify(item)).join(', ')}.`,
  )
}

/** The response of the pending request's kind that the command line's answer gives. */
export function interactionResponseFor(
  interaction: AgentLoopInteraction,
  answer: InteractionAnswer,
): AgentLoopInteractionResponse {
  return matchBy(interaction, 'kind')
    .with('confirm', (confirm) => confirmResponse(confirm, answer))
    .with('select', (select): AgentLoopInteractionResponse => {
      if (answer.kind === 'choice')
        return { kind: 'select', selected: listedChoice(select, answer.choice) }
      if (answer.kind === 'dismiss') return { kind: 'select', selected: null }
      throw mismatch(select, answer, '--choice <item> or --dismiss')
    })
    .with('input', 'editor', (question): AgentLoopInteractionResponse => {
      if (answer.kind === 'text') return { kind: question.kind, value: answer.text }
      if (answer.kind === 'dismiss') return { kind: question.kind, value: null }
      throw mismatch(question, answer, '--text, --stdin, --input-file or --dismiss')
    })
    .with('notify', (notice): AgentLoopInteractionResponse => {
      if (answer.kind === 'acknowledge') return { kind: 'notify', acknowledged: true }
      throw mismatch(notice, answer, '--acknowledge')
    })
    .with('custom', (custom): AgentLoopInteractionResponse => {
      if (answer.kind === 'value') return { kind: 'custom', value: answer.value }
      if (answer.kind === 'dismiss') return { kind: 'custom', value: null }
      throw mismatch(custom, answer, '--value-file <path|-> or --dismiss')
    })
    .exhaustive()
}
