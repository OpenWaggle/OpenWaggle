import { SessionId } from '@shared/types/brand'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useChatStore } from '@/features/chat/state'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('open-session-link-requests')

/** Links are opened one after another so two quick opens cannot interleave. */
let openQueue = Promise.resolve()

/**
 * Open the Session a link names (ADR 0056). Opening only shows it: an archived Session opens
 * with its archived notice and stays archived, and an unknown one is reported while the current
 * page stays, since the route would otherwise leave for a new session.
 */
async function openLinkedSession(navigate: ReturnType<typeof useNavigate>, sessionId: string) {
  const showToast = useUIStore.getState().showToast
  try {
    const [session] = await api.listSessionsByIds([SessionId(sessionId)])
    if (!session) {
      showToast(`Session not found: ${sessionId}`, 'error')
      return
    }
    // Selecting first leaves a new-session draft the way the sidebar and palette do.
    useChatStore.getState().setActiveSession(session.id)
    await navigate({ to: '/sessions/$sessionId', params: { sessionId: String(session.id) } })
  } catch (error) {
    logger.warn('Failed to open the linked Session', { error: String(error) })
    showToast(`Could not open session ${sessionId}.`, 'error')
  }
}

/**
 * Takes Session links the main process received from the operating system or from a link
 * clicked in this window. The request is pulled rather than pushed: one opened before this
 * window loaded is still waiting, and a reload cannot repeat it. The settings gate keeps a link
 * from selecting a project before recent projects are known.
 */
export function useOpenSessionLinkRequests(): void {
  const navigate = useNavigate()
  const settingsLoaded = usePreferencesStore((state) => state.isLoaded)

  useEffect(() => {
    if (!settingsLoaded) return
    const open = () => {
      openQueue = openQueue
        .then(async () => {
          for (
            let sessionId = await api.takeOpenSessionLinkRequest();
            sessionId;
            sessionId = await api.takeOpenSessionLinkRequest()
          ) {
            await openLinkedSession(navigate, sessionId)
          }
        })
        .catch((error: unknown) => {
          logger.warn('Failed to read the opened Session link', { error: String(error) })
        })
    }
    open()
    return api.onOpenSessionLinkRequested(open)
  }, [navigate, settingsLoaded])
}
