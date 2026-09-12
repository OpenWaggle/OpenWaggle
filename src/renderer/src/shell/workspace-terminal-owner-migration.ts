import {
  beginTerminalEventOwnerHandoff,
  migrateTerminalLayoutFocus,
  migrateTerminalSurfaceLeases,
  type TerminalGroupState,
  terminalInputDispatcher,
  terminalSidePanelLayoutKey,
  useTerminalStore,
} from '@/features/terminal'
import { api } from '@/shared/lib/ipc'
import { beginWorkspaceOwnerHandoff } from '@/shared/lib/workspace-owner-handoff'
import {
  ensureBrowserPreviewOwnerRegistered,
  quiesceBrowserPreviewOwnerForHandoff,
  unregisterBrowserPreviewOwner,
} from './browser-preview-owner-runtime'
import { releaseOwnerHandoffAfterCommit } from './terminal-owner-handoff-release'
import { collectOwnerReconciliationErrors } from './workspace-owner-reconciliation'
import { useWorkspacePanelStore } from './workspace-panel-store'

function terminalIds(group: TerminalGroupState | undefined) {
  return group?.tabs.flatMap((tab) => tab.panes.map((pane) => pane.terminalId)) ?? []
}

export async function migrateTerminalOwner(previousOwnerKey: string, nextOwnerKey: string) {
  const releaseOwnerFence = beginWorkspaceOwnerHandoff(previousOwnerKey, nextOwnerKey)
  let nativeOwnershipCommitted = false
  try {
    await Promise.all([
      quiesceBrowserPreviewOwnerForHandoff(previousOwnerKey),
      quiesceBrowserPreviewOwnerForHandoff(nextOwnerKey),
    ])
    return await commitTerminalOwnerMigration(previousOwnerKey, nextOwnerKey, () => {
      nativeOwnershipCommitted = true
    })
  } finally {
    releaseOwnerFence(nativeOwnershipCommitted)
  }
}

async function commitTerminalOwnerMigration(
  previousOwnerKey: string,
  nextOwnerKey: string,
  onNativeOwnershipCommitted: () => void,
) {
  const terminalStore = useTerminalStore.getState()
  if (
    terminalIds(terminalStore.groups[nextOwnerKey]).length > 0 ||
    terminalIds(terminalStore.groups[terminalSidePanelLayoutKey(nextOwnerKey)]).length > 0 ||
    (useWorkspacePanelStore.getState().groups[nextOwnerKey]?.browserTabs.length ?? 0) > 0
  ) {
    throw new Error('The Session already has workspace tabs. Draft tabs were kept in the draft.')
  }
  const previousSidePanelKey = terminalSidePanelLayoutKey(previousOwnerKey)
  const baseTerminalIds = terminalIds(terminalStore.groups[previousOwnerKey])
  const sideTerminalIds = terminalIds(terminalStore.groups[previousSidePanelKey])
  const migratingTerminalIds = [...baseTerminalIds, ...sideTerminalIds]
  const migratingPreviewIds =
    useWorkspacePanelStore
      .getState()
      .groups[previousOwnerKey]?.browserTabs.map((preview) => preview.id) ?? []
  terminalInputDispatcher.assertOwnerMigrationAvailable(
    previousOwnerKey,
    nextOwnerKey,
    migratingTerminalIds,
  )
  const releaseEventHandoff = beginTerminalEventOwnerHandoff(previousOwnerKey, nextOwnerKey)
  let nativeOwnershipCommitted = false
  try {
    await ensureBrowserPreviewOwnerRegistered(nextOwnerKey)
    await api.migrateTerminalOwner(previousOwnerKey, nextOwnerKey)
    // Later renderer persistence failures cannot move native ownership back.
    onNativeOwnershipCommitted()
    nativeOwnershipCommitted = true
    await Promise.allSettled(
      migratingPreviewIds.map((previewId) => api.closeBrowserPreview(previewId)),
    )
    const errors = collectOwnerReconciliationErrors([
      () =>
        terminalInputDispatcher.migrateOwner(previousOwnerKey, nextOwnerKey, migratingTerminalIds),
      () => migrateTerminalSurfaceLeases(previousOwnerKey, nextOwnerKey),
      () => terminalStore.rekeyRuntimeMetadata(previousOwnerKey, nextOwnerKey, sideTerminalIds),
      () => terminalStore.migrateGroup(previousOwnerKey, nextOwnerKey),
      () =>
        terminalStore.migrateGroup(previousSidePanelKey, terminalSidePanelLayoutKey(nextOwnerKey)),
      () => useWorkspacePanelStore.getState().migrateGroup(previousOwnerKey, nextOwnerKey),
      () => migrateTerminalLayoutFocus(previousOwnerKey, nextOwnerKey),
    ])
    try {
      await unregisterBrowserPreviewOwner(previousOwnerKey)
    } catch (error) {
      errors.push(error)
    }
    if (errors.length > 0) throw errors[0]
    return releaseEventHandoff
  } catch (error) {
    if (nativeOwnershipCommitted) releaseOwnerHandoffAfterCommit(releaseEventHandoff)
    else releaseEventHandoff()
    throw error
  }
}
