import type { SessionDetail } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { lastAnsweringModelReference } from '../domain/session-model-fallback'
import { ProviderService } from '../ports/provider-service'

/**
 * Whether the Session can run on `model`. A model the project's catalog lacks, such as a virtual
 * model whose extension is gone, still runs: Pi falls back to the model that answered the Session
 * last, as `pi --resume` does, and the Run says so. Refused only when that model is gone too.
 */
export function isSessionModelRunnable(
  model: string,
  session: Pick<SessionDetail, 'messages' | 'projectPath'>,
) {
  return Effect.gen(function* () {
    const providerService = yield* ProviderService
    if (yield* providerService.isKnownModel(model, session.projectPath)) return true
    const fallback = lastAnsweringModelReference(session)
    if (!fallback || fallback === model) return false
    return yield* providerService.isKnownModel(fallback, session.projectPath)
  })
}
