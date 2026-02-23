import type { ConversationId } from '@shared/types/brand'
import { createLogger } from '../logger'
import { BrowserSession } from './session'

const logger = createLogger('browser-registry')

const sessions = new Map<string, BrowserSession>()

export function getOrCreateSession(conversationId: ConversationId): BrowserSession {
  const key = String(conversationId)
  let session = sessions.get(key)
  if (!session) {
    logger.info('creating new session', { conversationId: key })
    session = new BrowserSession()
    sessions.set(key, session)
  }
  return session
}

export async function closeSession(conversationId: ConversationId): Promise<void> {
  const key = String(conversationId)
  const session = sessions.get(key)
  if (session) {
    logger.info('closing session', { conversationId: key })
    await session.close()
    sessions.delete(key)
  }
}

export async function closeAllSessions(): Promise<void> {
  logger.info('closing all browser sessions', { count: sessions.size })
  const closeTasks = Array.from(sessions.values()).map((s) => s.close().catch(() => {}))
  await Promise.all(closeTasks)
  sessions.clear()
}
