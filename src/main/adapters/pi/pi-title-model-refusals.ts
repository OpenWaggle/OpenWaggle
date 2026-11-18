import { classifyErrorMessage } from '@shared/types/errors'
import { createLogger } from '../../logger'
import { publishSessionHostEvent } from '../../session-host/session-host-events'

const logger = createLogger('pi-session-title-generator')

/** How long background title requests skip a model its provider refused. */
export const TITLE_MODEL_REFUSAL_COOLDOWN_MS = 30 * 60_000
const REFUSAL_REASON_MAX_LENGTH = 300

/** A Title model the provider refused, and when background requests try it again. */
export interface TitleModelRefusal {
  readonly model: string
  readonly reason: string
  readonly retryAt: number
}

const ACCESS_REFUSAL = /access ?denied|not authori[sz]ed|permission denied|forbidden/i
const REFUSAL_CODES = new Set([
  'api-key-invalid',
  'session-expired',
  'model-not-found',
  'insufficient-credits',
])

/**
 * A failure that the same request will meet again: access, sign-in, billing, or a model the
 * account cannot use, such as Bedrock's `AccessDeniedException` for a model without a
 * Marketplace subscription (#357). Rate limits and outages pass.
 */
export function isTitleModelRefusal(message: string) {
  return ACCESS_REFUSAL.test(message) || REFUSAL_CODES.has(classifyErrorMessage(message).code)
}

/**
 * Host-wide memory of refused Title models. Every new Session used to send its title request to a
 * model that answered `AccessDeniedException` before falling back to the Session model, and only
 * the log said so. A refused model is skipped for a while, and the user is told once per model.
 */
export class TitleModelRefusals {
  readonly #until = new Map<string, number>()
  readonly #told = new Set<string>()
  readonly #now: () => number
  readonly #notify: (refusal: TitleModelRefusal) => void

  constructor(
    options: {
      readonly now?: () => number
      readonly notify?: (refusal: TitleModelRefusal) => void
    } = {},
  ) {
    this.#now = options.now ?? Date.now
    this.#notify = options.notify ?? publishTitleModelRefusal
  }

  isPaused(model: string) {
    return (this.#until.get(model) ?? 0) > this.#now()
  }

  record(model: string, message: string) {
    const retryAt = this.#now() + TITLE_MODEL_REFUSAL_COOLDOWN_MS
    this.#until.set(model, retryAt)
    if (this.#told.has(model)) return
    this.#told.add(model)
    const reason = message.slice(0, REFUSAL_REASON_MAX_LENGTH)
    logger.warn('Title model refused; background titles skip it for a while', {
      model,
      retryAt: new Date(retryAt).toISOString(),
    })
    this.#notify({ model, reason, retryAt })
  }

  clear(model: string) {
    this.#until.delete(model)
    this.#told.delete(model)
  }
}

function publishTitleModelRefusal(refusal: TitleModelRefusal) {
  publishSessionHostEvent({ kind: 'session-title-model-refused', ...refusal })
}
