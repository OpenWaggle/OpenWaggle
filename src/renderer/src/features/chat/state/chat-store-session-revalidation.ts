import type { SessionDetail } from '@shared/types/session'
import { api } from '@/shared/lib/ipc'
import type { ChatState } from './chat-store-types'

type ChatGet = () => ChatState

/** The Host's copy; undefined when it could not be read, which keeps the cached copy. */
async function readSession(cached: SessionDetail) {
  try {
    return await api.getSessionDetail(cached.id)
  } catch {
    return undefined
  }
}

/**
 * The cached transcript shows at once; the Host's copy follows, as the `pi` CLI may have continued
 * a discovered Session while another was shown, or its Pi file's notice changed. A copy the Host
 * no longer has is refreshed as any other; a reply a newer read or change overtook, or older than
 * the copy shown, is dropped.
 */
export async function revalidateCachedSession(
  cached: SessionDetail,
  get: ChatGet,
  isCurrent: () => boolean,
) {
  const session = await readSession(cached)
  if (session === undefined || !isCurrent()) return
  if (!session) {
    void get().refreshSession(cached.id)
    return
  }
  const current = get().sessionById.get(cached.id)
  if (current && session.updatedAt < current.updatedAt) return
  get().upsertSession(session)
}
