import type * as PiAi from '@earendil-works/pi-ai'
import type { AssistantMessage } from '@earendil-works/pi-ai'

let piAi: Promise<typeof PiAi> | undefined

/**
 * Whether a later Waggle turn can recover from the error a turn ended with, by Pi's own rules:
 * Pi retries a transient error (an overload, a rate limit, a dropped connection), so another turn
 * may succeed. A rejected sign-in, a missing model, exhausted quota or billing, or a context
 * overflow Pi could not compact fails every later turn too.
 *
 * pi-ai, which Pi supplies to extensions, loads on a turn's first judgement rather than with the
 * package: it is ESM-only, and pi-waggle's CommonJS build must still load without it.
 */
export async function piWaggleTurnErrorClassifier() {
  piAi ??= import('@earendil-works/pi-ai')
  const { isContextOverflow, isRetryableAssistantError } = await piAi
  return (message: AssistantMessage) =>
    !isContextOverflow(message) && isRetryableAssistantError(message)
}
