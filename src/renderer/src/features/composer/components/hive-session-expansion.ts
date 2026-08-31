import type { SessionId } from '@shared/types/brand'

function collapseStorageKey(sessionId: SessionId) {
  return `openwaggle:hive-navigator-collapsed:${String(sessionId)}`
}

export function storedHiveExpansion(sessionId: SessionId) {
  try {
    const collapsed = localStorage.getItem(collapseStorageKey(sessionId))
    return collapsed === null ? undefined : collapsed !== 'true'
  } catch {
    return undefined
  }
}

export function storeHiveExpansion(sessionId: SessionId, expanded: boolean) {
  try {
    localStorage.setItem(collapseStorageKey(sessionId), String(!expanded))
  } catch {
    // Private storage failures should not disable navigation.
  }
}
