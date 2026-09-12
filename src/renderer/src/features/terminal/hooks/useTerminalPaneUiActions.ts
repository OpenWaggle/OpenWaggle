import { useCallback, useState } from 'react'
import {
  openAbsoluteFileInPreferredWorkspaceEditor,
  useOpenWorkspaceFile,
} from '@/features/workspace-files'
import { api } from '@/shared/lib/ipc'
import { openWorkspaceWebLink } from '@/shell/open-workspace-web-link'
import { useUIStore } from '@/shell/ui-store'
import type { TerminalPaneModel } from '../components/terminal-pane-model'
import { confirmTerminalStop } from '../lib/terminal-close'
import type { TerminalContextRange } from '../lib/terminal-context'
import { appendTerminalContextToComposer } from '../lib/terminal-context-composer'
import { projectActionEnvironmentForWorktree } from '../lib/terminal-launch-environment'
import { activateTerminalLinkTarget } from '../lib/terminal-link-activation'
import type { TerminalLinkActivationTarget } from '../lib/terminal-links'
import type { TerminalRestartOptions } from '../lib/terminal-pane-actions'
import { useTerminalStore } from '../state/terminal-store'

export function useTerminalLinkActivation(runtimeOwnerKey: string) {
  const showToast = useUIStore((state) => state.showToast)
  const openWorkspaceFile = useOpenWorkspaceFile()

  return useCallback(
    (target: TerminalLinkActivationTarget) => {
      void Promise.resolve(
        activateTerminalLinkTarget(target, {
          openUrl: (url) => openWorkspaceWebLink(runtimeOwnerKey, url),
          openExternalFile: (path, line, column) =>
            openAbsoluteFileInPreferredWorkspaceEditor({
              api,
              storage: window.localStorage,
              path,
              line,
              column,
            }),
          openWorkspaceFile,
        }),
      ).catch((error: unknown) => {
        showToast(
          error instanceof Error ? error.message : 'Terminal link could not be opened.',
          'error',
        )
      })
    },
    [openWorkspaceFile, runtimeOwnerKey, showToast],
  )
}

interface TerminalPaneSessionActions {
  readonly clearSelection: () => void
  readonly paste: () => Promise<void>
  readonly restart: (next?: TerminalRestartOptions) => Promise<void>
}

interface TerminalPaneUiActionOptions {
  readonly pane: TerminalPaneModel
  readonly session: TerminalPaneSessionActions
}

/** Coordinates the visible pane actions with runtime and persisted layout state. */
export function useTerminalPaneUiActions(options: TerminalPaneUiActionOptions) {
  const { pane, session } = options
  const [restartingInWorktree, setRestartingInWorktree] = useState(false)
  const setPaneCwd = useTerminalStore((state) => state.setPaneCwd)
  const setPaneLaunchEnv = useTerminalStore((state) => state.setPaneLaunchEnv)
  const showToast = useUIStore((state) => state.showToast)
  const runsInOriginalCheckout = pane.cwd !== pane.defaultCwd

  const restartShell = async (next?: TerminalRestartOptions) => {
    try {
      await session.restart(next)
      if (next?.cwd !== undefined) setPaneCwd(pane.ownerKey, pane.terminalId, next.cwd)
      if (next?.launchEnv !== undefined) {
        setPaneLaunchEnv(pane.ownerKey, pane.terminalId, next.launchEnv)
      }
      return true
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Terminal could not be restarted.',
        'error',
      )
      return false
    }
  }

  const restartInWorktree = async () => {
    if (restartingInWorktree) return
    setRestartingInWorktree(true)
    try {
      const confirmed = await confirmRestart(pane.runtimeOwnerKey, pane.terminalId, showToast)
      if (confirmed) {
        const nextLaunchEnv = projectActionEnvironmentForWorktree(pane.launchEnv, pane.defaultCwd)
        await restartShell({
          cwd: pane.defaultCwd,
          ...(nextLaunchEnv ? { launchEnv: nextLaunchEnv } : {}),
        })
      }
    } finally {
      setRestartingInWorktree(false)
    }
  }

  const addSelectionToChat = async (selectedText: string, range: TerminalContextRange | null) => {
    try {
      const payload = await appendTerminalContextToComposer({
        terminalId: pane.terminalId,
        terminalLabel: pane.label,
        cwd: pane.cwd,
        provenance: runsInOriginalCheckout ? 'original-checkout' : pane.defaultProvenance,
        selectedText,
        range,
      })
      if (payload === null) return
      session.clearSelection()
      showToast('Added terminal selection to chat.', 'success')
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Terminal selection could not be attached.',
        'error',
      )
    }
  }

  const copySelection = (selectedText: string) => {
    if (selectedText.length === 0) return
    try {
      api.copyToClipboard(selectedText)
      showToast('Copied terminal selection.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Clipboard could not be copied.', 'error')
    }
  }

  const pasteFromClipboard = () => {
    void session.paste().catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : 'Clipboard could not be pasted.', 'error')
    })
  }

  const openPort = (url: string) => {
    void openWorkspaceWebLink(pane.runtimeOwnerKey, url).catch((error: unknown) => {
      showToast(
        error instanceof Error ? error.message : 'Port preview could not be opened.',
        'error',
      )
    })
  }

  return {
    addSelectionToChat,
    copySelection,
    openPort,
    pasteFromClipboard,
    restartInWorktree,
    restartingInWorktree,
    restartShell,
    runsInOriginalCheckout,
  }
}

type ShowToast = ReturnType<typeof useUIStore.getState>['showToast']

async function confirmRestart(runtimeOwnerKey: string, terminalId: string, showToast: ShowToast) {
  try {
    return await confirmTerminalStop(
      runtimeOwnerKey,
      [{ terminalId, label: 'terminal in the session worktree' }],
      'restart',
    )
  } catch {
    showToast('Terminal activity could not be assessed.', 'error')
    return false
  }
}
