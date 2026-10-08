import type { SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { latestAnsweringModel, modelActionError } from '@/features/providers/state'

/**
 * Why a Session cannot send on `model`, counting the fallback its Runs would take: a model the
 * catalog lacks runs on the model that answered the Session last.
 */
export function sessionModelActionError(
  session: SessionDetail | null,
  model: SupportedModelId | undefined,
) {
  return modelActionError(model, latestAnsweringModel(session?.messages ?? []))
}
