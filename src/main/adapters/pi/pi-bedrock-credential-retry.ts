import { setTimeout as delay } from 'node:timers/promises'
import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
} from '@earendil-works/pi-ai'
import { isExpiredCredentialMessage } from '@shared/domain/error-classifier'
import { createLogger } from '../../logger'

const logger = createLogger('pi-bedrock-credentials')

/**
 * How long a retry waits. The AWS SDK refreshes an expiring SSO token from its cached refresh
 * token at most once per 30 s per SSO session, and a request made meanwhile fails at once with
 * "Token is expired". Several Runs that start together all fail but the one doing the refresh;
 * the wait lets that refresh write the new token.
 */
export const EXPIRED_CREDENTIAL_RETRY_DELAY_MS = 2_000

type ProviderStream<TModel, TContext, TOptions extends { readonly signal?: AbortSignal }> = (
  model: TModel,
  context: TContext,
  options?: TOptions,
) => AssistantMessageEventStream

/** Resolves false when the signal aborted the wait. */
type RetryWait = (milliseconds: number, signal: AbortSignal | undefined) => Promise<boolean>

const waitUnlessAborted: RetryWait = (milliseconds, signal) =>
  delay(milliseconds, undefined, signal ? { signal } : {}).then(
    () => true,
    () => false,
  )

type FirstAttempt =
  | { readonly kind: 'relayed' }
  | { readonly kind: 'expired-credentials'; readonly error: AssistantMessage }

/**
 * Relays an attempt, unless it failed on expired credentials before it streamed anything.
 * Pi's Bedrock stream emits `start` only once the request was accepted, so a credential failure
 * is its first event and nothing was shown or charged.
 */
async function relayUnlessCredentialsExpired(
  attempt: AssistantMessageEventStream,
  target: AssistantMessageEventStream,
): Promise<FirstAttempt> {
  let relayed = false
  let terminal: AssistantMessage | undefined
  for await (const event of attempt) {
    if (
      !relayed &&
      event.type === 'error' &&
      event.reason === 'error' &&
      isExpiredCredentialMessage(event.error.errorMessage ?? '')
    ) {
      return { kind: 'expired-credentials', error: event.error }
    }
    relayed = true
    terminal = terminalMessage(event) ?? terminal
    target.push(event)
  }
  target.end(terminal ?? (await attempt.result()))
  return { kind: 'relayed' }
}

function terminalMessage(event: AssistantMessageEvent) {
  if (event.type === 'done') return event.message
  if (event.type === 'error') return event.error
  return undefined
}

async function relay(attempt: AssistantMessageEventStream, target: AssistantMessageEventStream) {
  let terminal: AssistantMessage | undefined
  for await (const event of attempt) {
    terminal = terminalMessage(event) ?? terminal
    target.push(event)
  }
  target.end(terminal ?? (await attempt.result()))
}

function abortedEvent(error: AssistantMessage): AssistantMessageEvent {
  return { type: 'error', reason: 'aborted', error: { ...error, stopReason: 'aborted' } }
}

/**
 * Wraps a Pi Amazon Bedrock stream function so a request that failed on expired AWS credentials
 * is made once more before the Run fails (#357). Pi builds a new Bedrock client for each request,
 * so the retry resolves the credential chain again: an SSO token another request refreshed
 * meanwhile, or one the user renewed with `aws sso login`, is picked up. A second failure is
 * final and reaches the Run, which reports it as expired credentials.
 */
export function withExpiredCredentialRetry<
  TModel,
  TContext,
  TOptions extends { readonly signal?: AbortSignal },
>(
  stream: ProviderStream<TModel, TContext, TOptions>,
  dependencies: { readonly wait?: RetryWait; readonly delayMs?: number } = {},
): ProviderStream<TModel, TContext, TOptions> {
  const wait = dependencies.wait ?? waitUnlessAborted
  const delayMs = dependencies.delayMs ?? EXPIRED_CREDENTIAL_RETRY_DELAY_MS
  return (model, context, options) => {
    const target = createAssistantMessageEventStream()
    const run = async () => {
      const first = await relayUnlessCredentialsExpired(stream(model, context, options), target)
      if (first.kind === 'relayed') return
      logger.info('Provider credentials expired; resolving them once more', {
        provider: first.error.provider,
        model: first.error.model,
      })
      if (!(await wait(delayMs, options?.signal))) {
        target.push(abortedEvent(first.error))
        target.end()
        return
      }
      await relay(stream(model, context, options), target)
    }
    run().catch((error: unknown) => {
      logger.error('Expired credential retry failed', { error: String(error) })
      target.end()
    })
    return target
  }
}
