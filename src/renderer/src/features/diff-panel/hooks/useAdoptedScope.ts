import { useEffect } from 'react'
import { useDiffScopeStore } from '@/features/diff-panel/state/diff-scope-store'

/**
 * Hand the draft's scope choice to a session once, the first time that session has none of its own.
 *
 * Inheriting by lookup alone was a standing arrangement rather than a hand-off: a session with no entry read the
 * draft's entry on every render, so whatever the *next* draft in the same project chose became that session's
 * scope too, retroactively - and because the key a pending review lives under carries the scope, the review moved
 * with it. Copying once settles the session's own choice and leaves later drafts alone.
 */
export function useAdoptedScope(threadKey: string, draftAnchor: string | null) {
  const adoptScope = useDiffScopeStore((state) => state.adoptScope)

  useEffect(() => {
    if (!threadKey || draftAnchor === null || threadKey === draftAnchor) return
    adoptScope(threadKey, draftAnchor)
  }, [threadKey, draftAnchor, adoptScope])
}
