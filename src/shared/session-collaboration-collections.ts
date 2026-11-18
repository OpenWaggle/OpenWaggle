import { canonicalJson } from './canonical-json'

export const SESSION_COLLABORATION_COLLECTION_LIMIT = 256

export function hasUniqueCollaborationItemsBy<T>(
  items: readonly T[],
  identity: (item: T) => string,
) {
  return new Set(items.map(identity)).size === items.length
}

export function hasUniqueCollaborationStrings(items: readonly string[]) {
  return hasUniqueCollaborationItemsBy(items, (item) => item)
}

export function hasUniqueCollaborationStructures(items: readonly unknown[]) {
  return hasUniqueCollaborationItemsBy(items, canonicalJson)
}
