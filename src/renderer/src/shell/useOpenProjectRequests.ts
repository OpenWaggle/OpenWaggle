import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { openProjectInDraft, storeProjectDraftNavigation } from '@/features/sidebar/hooks'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('open-project-requests')

/** Requests are opened one after another so two quick launches cannot interleave. */
let openQueue = Promise.resolve()

/**
 * Takes projects requested by `openwaggle <path>`. The request is pulled rather than pushed:
 * one made before this window loaded is still waiting, and a reload cannot repeat it. The
 * settings gate keeps a request from selecting a project before recent projects are known.
 */
async function openRequestedProject(
  navigate: Parameters<typeof storeProjectDraftNavigation>[0],
  projectPath: string,
) {
  try {
    await openProjectInDraft(storeProjectDraftNavigation(navigate), projectPath)
  } catch (error) {
    logger.warn('Failed to open the requested project', { error: String(error) })
    useUIStore.getState().showToast(`Could not open ${projectPath}.`, 'error')
  }
}

export function useOpenProjectRequests(): void {
  const navigate = useNavigate()
  const settingsLoaded = usePreferencesStore((state) => state.isLoaded)

  useEffect(() => {
    if (!settingsLoaded) return
    const open = () => {
      openQueue = openQueue
        .then(async () => {
          // Several launches may be waiting, as when they came before this window loaded.
          for (
            let projectPath = await api.takeOpenProjectRequest();
            projectPath;
            projectPath = await api.takeOpenProjectRequest()
          ) {
            await openRequestedProject(navigate, projectPath)
          }
        })
        .catch((error: unknown) => {
          logger.warn('Failed to read the requested project', { error: String(error) })
        })
    }
    open()
    return api.onOpenProjectRequested(open)
  }, [navigate, settingsLoaded])
}
