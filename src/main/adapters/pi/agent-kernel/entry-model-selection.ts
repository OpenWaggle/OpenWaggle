import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { createModelRef } from '@shared/types/llm'

/**
 * The model the Session selected for each entry: the nearest `model_change` on its path. Under a
 * virtual model, a response names the physical model it was routed to, so its selection is the only
 * record that the virtual model sent it there.
 */
export function createEntryModelSelection(entryById: ReadonlyMap<string, SessionEntry>) {
  const selectionById = new Map<string, string | null>()

  function selectionOf(entryId: string | null): string | null {
    const pending: string[] = []
    let current = entryId
    let found: string | null = null
    while (current) {
      const cached = selectionById.get(current)
      if (cached !== undefined) {
        found = cached
        break
      }
      const entry = entryById.get(current)
      if (!entry) break
      if (entry.type === 'model_change') {
        found = createModelRef(entry.provider, entry.modelId)
        selectionById.set(entry.id, found)
        break
      }
      pending.push(current)
      current = entry.parentId
    }
    for (const id of pending) selectionById.set(id, found)
    return found
  }

  return selectionOf
}
