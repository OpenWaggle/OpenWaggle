import {
  SESSION_HOST_REFUSAL_KINDS,
  sessionHostErrorKindForThrownCode,
} from '@shared/domain/session-host-refusals'
import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import { CliError } from './cli-error'
import { option, type ParsedArguments } from './mcp-cli-arguments'
import { sessionControlPayload } from './run-cli-interactions'
import { sessionCliResultErrorKind } from './session-cli-exit-status'
import { LocalSessionClientProtocolError } from './session-host/local-session-client-protocol-error'
import {
  type InteractionAnswer,
  interactionResponseFromAnswerAlone,
} from './sessions-cli-interaction-response'

export type ExecuteHostCommand = (
  payload: LocalSessionCommandPayload,
) => Promise<LocalSessionCommandResult>

interface UnlistedRequest {
  readonly answer: InteractionAnswer
  readonly arguments: ParsedArguments
  readonly execute: ExecuteHostCommand
  readonly sessionId: string
  readonly runId: string
  readonly interactionId: string
}

/**
 * Asks the Session Host why a request is not listed, with a `notify` answer, which settles
 * nothing because a `notify` request never waits for one. The Host checks the caller's
 * capability, then whether the request is pending, then its kind. So it fails the command with
 * `capability_denied`, which the caller throws as a protocol error, or answers
 * `interaction-not-found`, or `interaction-mismatch` (a `conflict`, as in the Host's table) for
 * a pending approval the caller may not answer. It returns the error for a request the caller may not answer, or
 * `undefined` for one that is not pending.
 */
async function whyUnlisted(
  input: Omit<UnlistedRequest, 'answer' | 'arguments'>,
  missing: string,
  mismatch = `Request ${input.interactionId} is pending, but this caller may not answer it. An approval request needs approval-respond and sessions:approve.`,
) {
  const result = await input.execute(
    sessionControlPayload({
      operation: 'request-respond',
      sessionId: input.sessionId,
      runId: input.runId,
      interactionId: input.interactionId,
      kind: 'notify',
      response: { kind: 'notify', acknowledged: true },
    }),
  )
  const outcome = result.contract === 'session-control-v2' ? result.response.outcome : undefined
  if (outcome?.effect !== 'rejected') {
    // A notify answer settles nothing, so anything but a refusal is a Host this CLI does not know.
    throw new Error('The Session Host answered the request-respond probe with another result.')
  }
  const code = outcome.code
  if (code === 'interaction-not-found') return undefined
  // Every kind comes from the Session Host's table (ADR 0063), so the CLI never assigns one.
  if (code === 'interaction-mismatch') {
    return new CliError(SESSION_HOST_REFUSAL_KINDS[code], mismatch, { code })
  }
  const kind = sessionCliResultErrorKind(result) ?? 'conflict'
  return new CliError(kind, `${missing} (${code})`, { code })
}

/**
 * A request `requests-list` does not show: answered, never there, or one this caller may not
 * answer, which the Session Host tells apart. For one that is not pending, an `--idempotency-key`
 * retry whose option alone names the answer's kind is sent as it is, so the Host replays the
 * outcome it recorded for the key.
 */
export async function unlistedRequestResponse(input: UnlistedRequest) {
  const missing = `Run ${input.runId} of Session ${input.sessionId} has no pending request ${input.interactionId} that this caller may answer.`
  const refusal = await whyUnlisted(input, missing)
  if (refusal) throw refusal
  const retry = option(input.arguments, 'idempotency-key') !== undefined
  const response = retry ? interactionResponseFromAnswerAlone(input.answer) : undefined
  if (response) return { interactionResponse: response }
  const hint = retry
    ? ' --text, --stdin, --input-file and --dismiss fit more than one kind of request, so this retry cannot be matched to the recorded answer.'
    : ''
  const code = 'interaction-not-found'
  throw new CliError(SESSION_HOST_REFUSAL_KINDS[code], `${missing}${hint}`, { code })
}

/**
 * An approval request answered with `request-respond`. The Session Host refuses that, with
 * `capability_denied` for a caller without `sessions:respond` and `interaction-mismatch` for one
 * with it, so the CLI asks it with the same probe it uses for an unlisted request. The caller
 * then gets the same exit whether or not `requests-list` showed it the approval.
 */
export async function approvalRequestError(input: Omit<UnlistedRequest, 'answer' | 'arguments'>) {
  const approve = `openwaggle hive approval-respond ${input.sessionId} ${input.runId} ${input.interactionId} allow|deny`
  const missing = `Run ${input.runId} of Session ${input.sessionId} has no pending request ${input.interactionId} that this caller may answer.`
  const hint = `Request ${input.interactionId} is an approval request. Answer it with '${approve}'.`
  const refusal = await whyUnlisted(input, missing, hint).catch((error: unknown) => {
    // A refusal sent as an error, such as capability_denied: keep its kind and code, and name
    // the command this caller should use.
    if (!(error instanceof LocalSessionClientProtocolError)) throw error
    return new CliError(
      error.errorKind ?? sessionHostErrorKindForThrownCode(error.code),
      `${hint} The Session Host refused request-respond (${error.code}): ${error.message}`,
      { cause: error, code: error.code },
    )
  })
  if (refusal) return refusal
  // Answered between the read and the probe.
  const code = 'interaction-not-found'
  return new CliError(SESSION_HOST_REFUSAL_KINDS[code], missing, { code })
}
