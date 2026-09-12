import type { SessionId } from '@shared/types/brand'
import { withSessionLineageMutation } from '../../store/session-details/session-deletion-fence'

/** Probe the production SQLite adapter's mutation admission without opening a database. */
export function probeSessionLineageMutation<A>(
  sessionIds: readonly SessionId[],
  mutation: () => Promise<A>,
): Promise<A> {
  return withSessionLineageMutation(sessionIds, mutation)
}
