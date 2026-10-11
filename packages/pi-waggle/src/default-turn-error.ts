import type * as PiAi from '@earendil-works/pi-ai'
import type { AssistantMessage } from '@earendil-works/pi-ai'

type TurnErrorClassifier = (message: AssistantMessage) => boolean

/**
 * Whether a later Waggle turn can recover from the error a turn ended with, by Pi's own rules:
 * Pi retries a transient error (an overload, a rate limit, a dropped connection), so another turn
 * may succeed. A rejected sign-in, a missing model, exhausted quota or billing, or a context
 * overflow Pi could not compact fails every later turn too.
 *
 * pi-ai, which Pi supplies to extensions, loads on a turn's first judgement rather than with the
 * package: it is ESM-only, so pi-waggle's CommonJS build cannot require it. Where it cannot load,
 * there is no classifier and every error counts as recoverable, as before; a failed load is not
 * kept, so the next turn tries again.
 */
export function createPiWaggleTurnErrorClassifier(
  load: () => Promise<typeof PiAi> = () => import('@earendil-works/pi-ai'),
) {
  let classifier: TurnErrorClassifier | undefined
  return async (): Promise<TurnErrorClassifier | undefined> => {
    if (classifier) return classifier
    try {
      const { isContextOverflow, isRetryableAssistantError } = await load()
      classifier = (message) => !isContextOverflow(message) && isRetryableAssistantError(message)
      return classifier
    } catch {
      return undefined
    }
  }
}

export const piWaggleTurnErrorClassifier = createPiWaggleTurnErrorClassifier()
