import { SESSION_COLLABORATION_COLLECTION_LIMIT } from './session-collaboration-collections'
import { SESSION_QUERY_MAX_PATH_LENGTH } from './types/session-query'

const BYTES_PER_MEBIBYTE = 1024 * 1024

/** Canonical limits for Session commands accepted by IPC, CLI, and the Session Host. */
export const SESSION_INPUT_LIMITS = {
  idLength: 512,
  persistedTextBytes: 16 * BYTES_PER_MEBIBYTE,
  mcpTextLength: 131_072,
  itemTextLength: 16_384,
  jsonLength: 131_072,
  pathLength: SESSION_QUERY_MAX_PATH_LENGTH,
  arrayItems: SESSION_COLLABORATION_COLLECTION_LIMIT,
  expandedTreeNodeItems: 10_000,
} as const

export function isSessionInputTextWithinLimit(value: string) {
  if (value.length > SESSION_INPUT_LIMITS.persistedTextBytes) return false
  return new TextEncoder().encode(value).byteLength <= SESSION_INPUT_LIMITS.persistedTextBytes
}

export function isSessionInputJsonWithinLimit(value: unknown) {
  try {
    return JSON.stringify(value).length <= SESSION_INPUT_LIMITS.jsonLength
  } catch {
    return false
  }
}
