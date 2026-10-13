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
 * a discovered Session while another was shown. Only a changed copy replaces it, and one the Host
 * no longer has is refreshed as any other.
 */
export async function revalidateCachedSession(cached: SessionDetail, get: ChatGet) {
  const session = await readSession(cached)
  if (session === undefined) return
  if (!session) {
    void get().refreshSession(cached.id)
    return
  }
  const unchanged =
    session.updatedAt === cached.updatedAt && session.messages.length === cached.messages.length
  if (!unchanged) get().upsertSession(session)
}
