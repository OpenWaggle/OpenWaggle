import { useEffect, useEffectEvent } from 'react'
import { type ActionPanelDraft, draftTarget, isDraftDirty } from '../lib/action-panel-drafts'
import { useActionPanelStore } from '../state/action-panel-store'

export type PanelDraftState<T extends ActionPanelDraft> =
  | { readonly status: 'loading' }
  /** Another unfinished draft exists for this project; the user decides first (ADR 0038). */
  | { readonly status: 'switch'; readonly existing: ActionPanelDraft }
  | {
      readonly status: 'ready'
      readonly draft: T
      readonly update: (next: T) => void
      readonly discard: () => void
    }

interface PanelDraftInput<T extends ActionPanelDraft> {
  readonly projectPath: string
  /** The saved thing the request is for, as produced by draftTarget. */
  readonly target: string
  /** Whether the data a fresh draft needs has loaded. */
  readonly ready: boolean
  /** Builds a fresh draft. Called from an effect, never during render. */
  readonly create: () => T
  /** A stored draft for the same target is resumed only when it still matches the request. */
  readonly matches: (draft: ActionPanelDraft) => draft is T
}

/**
 * One Project action draft per project, kept across leaving the panel and restarting (ADR 0038).
 * A matching draft resumes; a pristine one is replaced; an unfinished one asks first.
 */
export function usePanelDraft<T extends ActionPanelDraft>(
  input: PanelDraftInput<T>,
): PanelDraftState<T> {
  const stored = useActionPanelStore((state) => state.drafts[input.projectPath])
  const setDraft = useActionPanelStore((state) => state.setDraft)
  const discardDraft = useActionPanelStore((state) => state.discardDraft)
  const resumable =
    stored !== undefined && input.matches(stored) && draftTarget(stored) === input.target
  const blocking = stored !== undefined && !resumable && isDraftDirty(stored)
  const needsFresh = input.ready && !resumable && !blocking
  const { projectPath } = input
  const createDraft = useEffectEvent(() => input.create())
  useEffect(() => {
    if (needsFresh) setDraft(projectPath, createDraft())
  }, [needsFresh, projectPath, setDraft])
  if (resumable && stored && input.matches(stored))
    return {
      status: 'ready',
      draft: stored,
      update: (next) => setDraft(projectPath, next),
      discard: () => discardDraft(projectPath),
    }
  if (blocking && stored) return { status: 'switch', existing: stored }
  return { status: 'loading' }
}
