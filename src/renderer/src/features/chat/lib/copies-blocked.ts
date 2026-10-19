import { type AgentCompactionStatus, isCompactionRunning } from './compaction-lifecycle'

/**
 * Whether the Host holds the Session's writer, so the transcript offers no branch or copy: from a
 * send until its Run settles, which outlasts the transcript's own loading state, and while a
 * compaction runs in an otherwise idle Session.
 */
export function areCopiesBlocked(flags: {
  readonly isLoading: boolean
  readonly isFinishing: boolean
  readonly compactionStatus: AgentCompactionStatus | null
}) {
  return flags.isLoading || flags.isFinishing || isCompactionRunning(flags.compactionStatus)
}
