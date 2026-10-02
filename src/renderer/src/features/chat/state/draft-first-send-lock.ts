import { useChatStore } from './chat-store'
import { draftMaterializationGeneration } from './draft-session-materialization'

/**
 * Locks the draft's settings (`isMaterializing`) for its first send, before anything is awaited,
 * so no pick can land between the moment the send reads the draft's settings and the moment its
 * Session exists. Returns the release, a no-op once the Session replaced the draft or the user
 * moved to another draft or Session.
 */
export function lockDraftForFirstSend(projectPath: string): () => void {
  const state = useChatStore.getState()
  const draft = state.draftSession
  if (state.activeSessionId !== null || draft?.projectPath !== projectPath || draft.isMaterializing)
    return () => {}
  const generation = draftMaterializationGeneration()
  useChatStore.setState({ draftSession: { ...draft, isMaterializing: true } })
  return () => {
    if (generation !== draftMaterializationGeneration()) return
    useChatStore.setState((current) => {
      if (current.draftSession?.projectPath !== projectPath || !current.draftSession.isMaterializing)
        return {}
      const { isMaterializing: _materializing, ...draftSession } = current.draftSession
      return { draftSession }
    })
  }
}
