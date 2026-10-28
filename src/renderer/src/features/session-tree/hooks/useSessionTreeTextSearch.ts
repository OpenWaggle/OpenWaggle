import type { SessionTree, SessionTreeSearchCursor } from '@shared/types/session'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('session-tree-text-search')

/** Typing pauses this long before the Host searches the Session's text. */
const SEARCH_DEBOUNCE_MS = 200

/** What a failed search may say about itself: never its message, which can hold the query. */
function searchFailureContext(error: unknown) {
  if (!(error instanceof Error)) return { errorType: typeof error }
  const code: unknown = Reflect.get(error, 'code')
  return { errorName: error.name, ...(typeof code === 'string' ? { code } : {}) }
}

interface TreeSearchResult {
  /** The Session and query it answers. */
  readonly key: string
  readonly nodeIds: ReadonlySet<string>
  /** The loaded tree it answered (`updatedAt:nodeCount`): a later one is searched again. */
  readonly treeRevision: string
  /** Where it stopped: the next search for the same key reads only nodes appended since. */
  readonly cursor: SessionTreeSearchCursor | null
}

/**
 * The tree nodes whose full transcript text matches `query`, searched on the Host (B5): the tree
 * carries only the start of each message, so a match deeper in a message must come from there.
 * When the loaded tree changes, the Host is asked again with the previous search's cursor, so a
 * Run's appends are searched alone, not the whole Session on each one (review V2 P3-1); the Host
 * reads everything again once a node it read has changed. Until that answer comes, the previous
 * matches for the same Session and query stay shown; a result for another query or Session never
 * is.
 */
export function useSessionTreeTextSearch(
  tree: SessionTree | null,
  query: string,
): ReadonlySet<string> | undefined {
  const sessionId = tree?.session.id ?? null
  const treeRevision = tree ? `${String(tree.session.updatedAt)}:${String(tree.nodes.length)}` : ''
  const normalized = query.trim().replace(/\s+/g, ' ')
  const key = `${String(sessionId)}|${normalized}`
  const [result, setResult] = useState<TreeSearchResult | null>(null)
  // The last answer, read when the next search starts; the effect does not re-run on it.
  const latest = useRef<TreeSearchResult | null>(null)

  useEffect(() => {
    if (!sessionId || !normalized) return
    let cancelled = false
    const timer = setTimeout(() => {
      const previous = latest.current?.key === key ? latest.current : null
      const accept = (next: TreeSearchResult) => {
        if (cancelled) return
        latest.current = next
        setResult(next)
      }
      // Without a cursor the call has two arguments: an absent third one crosses as nothing.
      const search = previous?.cursor
        ? api.searchSessionTree(sessionId, normalized, previous.cursor)
        : api.searchSessionTree(sessionId, normalized)
      search
        .then((page) => {
          const found = page.nodeIds.map(String)
          accept({
            key,
            treeRevision,
            nodeIds: new Set(
              page.incremental && previous ? [...previous.nodeIds, ...found] : found,
            ),
            cursor: page.cursor,
          })
        })
        .catch((error: unknown) => {
          // The window still matches the start of each message it holds; full-text matches are
          // missing, so say so rather than show fewer matches silently.
          logger.warn('Session tree text search failed', {
            sessionId,
            ...searchFailureContext(error),
          })
          accept({ key, treeRevision, nodeIds: new Set(), cursor: null })
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key, normalized, sessionId, treeRevision])

  return result?.key === key ? result.nodeIds : undefined
}
