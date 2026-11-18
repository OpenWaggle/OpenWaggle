import { useChatStore } from '@/features/chat/state'

/** The active session's project, when it differs from the project the panel saves to. */
export function useOtherSessionProject(projectPath: string) {
  const other = useChatStore((state) => state.activeSession?.projectPath ?? null)
  return other && other !== projectPath ? other : null
}
