import { SessionId } from '@shared/types/brand'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { HiveSession } from '@/queries/session-hive-contract'
import {
  hiveTreeMembers,
  hiveTreeRoot,
  sessionHiveTreeQueryOptions,
} from '@/queries/session-hive-tree'
import { useToolRowSessionId } from '../components/ToolRowSessionContext'

const NO_SESSIONS: readonly HiveSession[] = []

/**
 * The Sessions of the transcript's Hive, read through the Hive panel's own query so a row names
 * Workers as the panel does and refreshes with it. Members past the first page are not read here;
 * their rows keep the bare "Worker".
 */
export function useSessionsToolHive(): readonly HiveSession[] {
  const sessionId = useToolRowSessionId()
  const query = useInfiniteQuery({
    ...sessionHiveTreeQueryOptions(SessionId(sessionId ?? '')),
    enabled: sessionId !== null,
  })
  const pages = query.data?.pages
  if (!pages) return NO_SESSIONS
  const root = hiveTreeRoot(pages)
  return root ? [root, ...hiveTreeMembers(pages)] : hiveTreeMembers(pages)
}
