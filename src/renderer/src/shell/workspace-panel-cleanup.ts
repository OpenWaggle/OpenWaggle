import { useBrowserPreviewFloatingStore } from '@/features/browser-preview'
import { terminalInputDispatcher, useTerminalStore } from '@/features/terminal'
import { api } from '@/shared/lib/ipc'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { unregisterBrowserPreviewOwner } from './browser-preview-owner-runtime'
import { useWorkspacePanelStore } from './workspace-panel-store'

async function closeBrowserPreviews(previewIds: readonly string[]) {
  await Promise.allSettled(previewIds.map((previewId) => api.closeBrowserPreview(previewId)))
}

/** Stops ephemeral renderer state while retaining layouts for an archived Session's restore. */
export async function archiveWorkspaceOwner(ownerKey: string) {
  terminalInputDispatcher.clearOwner(ownerKey)
  useTerminalStore.getState().clearOwnerRuntimeMetadata(ownerKey)
  useBrowserPreviewFloatingStore.getState().removeOwner(ownerKey)
  useRightSidebarCoordinator.getState().releaseWorkspace(ownerKey)
  const previewIds =
    useWorkspacePanelStore.getState().groups[ownerKey]?.browserTabs.map((tab) => tab.id) ?? []
  await closeBrowserPreviews(previewIds)
  await unregisterBrowserPreviewOwner(ownerKey)
}

/** Removes all renderer-owned state after main permanently deletes the Session. */
export async function deleteWorkspaceOwner(ownerKey: string) {
  terminalInputDispatcher.clearOwner(ownerKey)
  useTerminalStore.getState().removeOwner(ownerKey)
  const previewIds = useWorkspacePanelStore.getState().removeGroup(ownerKey)
  await closeBrowserPreviews(previewIds)
  await unregisterBrowserPreviewOwner(ownerKey)
}
