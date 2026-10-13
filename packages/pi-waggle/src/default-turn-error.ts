import type * as PiAi from '@earendil-works/pi-ai'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { importEsm } from './esm-import.js'

type TurnErrorClassifier = (message: AssistantMessage) => boolean
type TurnErrorRules = Pick<typeof PiAi, 'isContextOverflow' | 'isRetryableAssistantError'>

const PI_AI = '@earendil-works/pi-ai'

function hasTurnErrorRules(value: unknown): value is TurnErrorRules {
  return (
    typeof value === 'object' &&
    value !== null &&
    'isContextOverflow' in value &&
    typeof value.isContextOverflow === 'function' &&
    'isRetryableAssistantError' in value &&
    typeof value.isRetryableAssistantError === 'function'
  )
}

/**
 * pi-ai, which Pi supplies to extensions. The ES module build imports it as Pi maps it; the
 * CommonJS build's compiled `require()` cannot load it, as pi-ai is ESM-only, so it imports it
 * with a real `import()` instead.
 */
async function loadPiAi(): Promise<TurnErrorRules> {
  try {
    return await import('@earendil-works/pi-ai')
  } catch (error) {
    const loaded = await importEsm(PI_AI).catch(() => undefined)
    if (hasTurnErrorRules(loaded)) return loaded
    throw error
  }
}

/**
 * Whether a later Waggle turn can recover from the error a turn ended with, by Pi's own rules:
 * Pi retries a transient error (an overload, a rate limit, a dropped connection), so another turn
 * may succeed. A rejected sign-in, a missing model, exhausted quota or billing, or a context
 * overflow Pi could not compact fails every later turn too.
 *
 * pi-ai loads on a turn's first judgement rather than with the package. Where it cannot load at
 * all, there is no classifier and every error counts as recoverable; a failed load is not kept,
 * so the next turn tries again.
 */
export function createPiWaggleTurnErrorClassifier(load: () => Promise<TurnErrorRules> = loadPiAi) {
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
