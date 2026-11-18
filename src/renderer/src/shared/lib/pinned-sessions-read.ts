import { coalescedRead } from './coalesced-read'
import { api } from './ipc'

/**
 * The Pinned sessions, read once for every caller asking in the same task: the Session catalog
 * and the pin store both read them at startup (boot fetch dedupe).
 */
export const readPinnedSessions = coalescedRead(() => api.listPinnedSessions())
