import type { SessionTree } from '@shared/types/session'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'

/** Typing pauses this long before the Host searches the Session's text. */
const SEARCH_DEBOUNCE_MS = 200

interface TreeSearchResult {
  readonly key: string
  readonly nodeIds: ReadonlySet<string>
}

/**
 * The tree nodes whose full transcript text matches `query`, searched on the Host (B5): the tree
 * carries only the start of each message, so a match deeper in a message must come from there.
 * The loaded tree's revision is part of the key, so new or changed nodes are searched again; a
 * result for an earlier query or tree is never shown for the current one.
 */
export function useSessionTreeTextSearch(
  tree: SessionTree | null,
  query: string,
): ReadonlySet<string> | undefined {
  const sessionId = tree?.session.id ?? null
  const treeRevision = tree ? `${String(tree.session.updatedAt)}:${String(tree.nodes.length)}` : ''
  const normalized = query.trim().replace(/\s+/g, ' ')
  const key = `${String(sessionId)}|${treeRevision}|${normalized}`
  const [result, setResult] = useState<TreeSearchResult | null>(null)

  useEffect(() => {
    if (!sessionId || !normalized) return
    let cancelled = false
    const timer = setTimeout(() => {
      api
        .searchSessionTree(sessionId, normalized)
        .then((ids) => {
          if (!cancelled) setResult({ key, nodeIds: new Set(ids.map(String)) })
        })
        .catch(() => {
          // The window still matches the start of each message it holds.
          if (!cancelled) setResult({ key, nodeIds: new Set() })
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key, normalized, sessionId])

  return result?.key === key ? result.nodeIds : undefined
}
