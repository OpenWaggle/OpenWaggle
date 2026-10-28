import { setTimeout as delay } from 'node:timers/promises'
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  type Model,
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

/**
 * AWS refusing the request's credentials or signature, as opposed to their expiry: rotated or
 * revoked keys (`UnrecognizedClientException`, "The security token included in the request is
 * invalid"), a bad signature, or access denied. Retrying with the same credentials cannot help.
 */
const REJECTED_CREDENTIAL_PATTERNS = [
  'unrecognizedclientexception',
  'security token included in the request is invalid',
  'invalidsignatureexception',
  'signature we calculated does not match',
  'accessdeniedexception',
  'incompletesignature',
] as const

export function isRejectedCredentialMessage(message: string) {
  const lower = message.toLowerCase()
  return REJECTED_CREDENTIAL_PATTERNS.some((pattern) => lower.includes(pattern))
}

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
  onRejectedCredentials: (error: AssistantMessage) => void,
): Promise<FirstAttempt> {
  let relayed = false
  let terminal: AssistantMessage | undefined
  for await (const event of attempt) {
    if (!relayed && event.type === 'error' && event.reason === 'error') {
      const message = event.error.errorMessage ?? ''
      if (isExpiredCredentialMessage(message)) {
        return { kind: 'expired-credentials', error: event.error }
      }
      if (isRejectedCredentialMessage(message)) onRejectedCredentials(event.error)
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

type ModelIdentity = Pick<Model<Api>, 'api' | 'provider' | 'id'>

/** The error a Run sees when relaying itself failed, so a caller awaiting the result never hangs. */
function relayFailure(model: ModelIdentity, error: unknown): AssistantMessageEvent {
  return {
    type: 'error',
    reason: 'error',
    error: {
      role: 'assistant',
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    },
  }
}

function abortedEvent(error: AssistantMessage): AssistantMessageEvent {
  return { type: 'error', reason: 'aborted', error: { ...error, stopReason: 'aborted' } }
}

interface ExpiredCredentialRetryDependencies {
  readonly wait?: RetryWait
  readonly delayMs?: number
  /**
   * Drops cached Bedrock clients, so the retry builds a new one and resolves the credential chain
   * again instead of reusing the provider that just failed.
   */
  readonly invalidateClients?: () => void
}

/**
 * Wraps a Pi Amazon Bedrock stream function so a request that failed on expired AWS credentials
 * is made once more before the Run fails (#357). Pi reuses one Bedrock client per configuration,
 * with its credential provider and HTTP/2 session, so the retry first drops the cached clients
 * and then resolves the credential chain again: an SSO token another request refreshed meanwhile,
 * or one the user renewed with `aws sso login`, is picked up. A second failure is final and
 * reaches the Run, which reports it as expired credentials. Credentials AWS refuses outright
 * (rotated or revoked keys, a bad signature, access denied) fail at once, but drop the cached
 * clients too: the SDK memoizes static credentials for a client's life, so the user's fix would
 * otherwise not apply until the client sat unused for ten minutes.
 */
export function withExpiredCredentialRetry<
  TModel extends ModelIdentity,
  TContext,
  TOptions extends { readonly signal?: AbortSignal },
>(
  stream: ProviderStream<TModel, TContext, TOptions>,
  dependencies: ExpiredCredentialRetryDependencies = {},
): ProviderStream<TModel, TContext, TOptions> {
  const wait = dependencies.wait ?? waitUnlessAborted
  const delayMs = dependencies.delayMs ?? EXPIRED_CREDENTIAL_RETRY_DELAY_MS
  return (model, context, options) => {
    const target = createAssistantMessageEventStream()
    const run = async () => {
      const first = await relayUnlessCredentialsExpired(
        stream(model, context, options),
        target,
        (error) => {
          // Not retried, but the cached client and its memoized credentials are dropped, so the
          // request after the user fixes them (`aws configure`, a new key) resolves them again.
          logger.info(
            'Provider refused the credentials; resolving them again on the next request',
            {
              provider: error.provider,
              model: error.model,
            },
          )
          dependencies.invalidateClients?.()
        },
      )
      if (first.kind === 'relayed') return
      logger.info('Provider credentials expired; resolving them once more', {
        provider: first.error.provider,
        model: first.error.model,
      })
      dependencies.invalidateClients?.()
      if (!(await wait(delayMs, options?.signal))) {
        target.push(abortedEvent(first.error))
        target.end()
        return
      }
      await relay(stream(model, context, options), target)
    }
    run().catch((error: unknown) => {
      logger.error('Expired credential retry failed', { error: String(error) })
      target.push(relayFailure(model, error))
      target.end()
    })
    return target
  }
}
