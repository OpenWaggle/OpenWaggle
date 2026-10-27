import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { idleCacheWarming } from './pi-idle-cache-warming'

/**
 * A compaction computed while the Session was idle: Pi installs it before the first request, or
 * drops it if the conversation or model changed.
 */
export function installIdleCompaction(sessionId: string, session: AgentSession) {
  const idleCompaction = idleCacheWarming.takeIdleCompaction(sessionId)
  if (idleCompaction) session.setPendingCompaction(idleCompaction)
}
