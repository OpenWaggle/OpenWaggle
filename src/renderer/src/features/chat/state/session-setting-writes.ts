import type { SessionId } from '@shared/types/brand'
import { settledSessionModelWrites } from './session-model-writes'
import { settledThinkingLevelWrites } from './session-thinking-level-writes'

/**
 * Resolves once every model and thinking-level write already requested for the Session has
 * settled. The Host reads both from the Session when a Run starts, so a send or an enqueue waits
 * for a pick made just before it.
 */
export async function settledSessionSettingWrites(sessionId: SessionId): Promise<void> {
  await Promise.all([settledSessionModelWrites(sessionId), settledThinkingLevelWrites(sessionId)])
}
