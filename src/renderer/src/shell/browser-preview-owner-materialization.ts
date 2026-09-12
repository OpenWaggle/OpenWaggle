import type { BrowserPreviewState } from '@shared/types/browser-preview'
import type {
  BrowserPreviewOpenRequest,
  BrowserPreviewOpenRequestAck,
} from '@shared/types/browser-preview-owner'
import { resolveBrowserProfiles } from '@shared/types/browser-profile'
import {
  type BrowserPreviewFloatingState,
  clearBrowserPreviewExternalFallback,
  HIDDEN_BROWSER_PREVIEW_BOUNDS,
  normalizeBrowserPreviewUrl,
  useBrowserPreviewFloatingStore,
} from '@/features/browser-preview'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import type { BrowserPreviewTabState, WorkspacePanelGroupState } from './workspace-panel-model'
import { MAX_BROWSER_TABS } from './workspace-panel-model'
import { useWorkspacePanelStore } from './workspace-panel-store'

export interface BrowserPreviewMaterializationOperation {
  readonly request: BrowserPreviewOpenRequest
  readonly previousGroup: WorkspacePanelGroupState | undefined
  readonly previousFloating: BrowserPreviewFloatingState | undefined
  evictedPreviewId: string | null
  replacedPreviewState: BrowserPreviewState | null
  canceled: boolean
  mutatedRendererState: boolean
}

type IsLatestMaterialization = (operation: BrowserPreviewMaterializationOperation) => boolean

export function createBrowserPreviewMaterializationOperation(
  request: BrowserPreviewOpenRequest,
): BrowserPreviewMaterializationOperation {
  return {
    request,
    previousGroup: useWorkspacePanelStore.getState().groups[request.ownerKey],
    previousFloating: useBrowserPreviewFloatingStore.getState().byOwnerKey[request.ownerKey],
    evictedPreviewId: null,
    replacedPreviewState: null,
    canceled: false,
    mutatedRendererState: false,
  }
}

export function shouldRollbackBrowserPreviewMaterialization(
  operation: BrowserPreviewMaterializationOperation,
  isLatest: IsLatestMaterialization,
) {
  return operation.canceled || !isLatest(operation)
}

function restoredTabs(
  operation: BrowserPreviewMaterializationOperation,
  currentTabs: readonly BrowserPreviewTabState[],
) {
  const affectedIds = new Set([operation.request.previewId])
  if (operation.evictedPreviewId !== null) affectedIds.add(operation.evictedPreviewId)
  const next = currentTabs.filter((tab) => !affectedIds.has(tab.id))
  const previousAffected = (operation.previousGroup?.browserTabs ?? [])
    .map((tab, index) => ({ index, tab }))
    .filter(({ tab }) => affectedIds.has(tab.id))
  for (const { index, tab } of previousAffected) {
    next.splice(Math.min(index, next.length), 0, tab)
  }
  return next.slice(-MAX_BROWSER_TABS)
}

function rollbackWorkspaceState(operation: BrowserPreviewMaterializationOperation) {
  const previous = operation.previousGroup
  useWorkspacePanelStore.setState((state) => {
    const current = state.groups[operation.request.ownerKey]
    if (!current) return state
    const requestStillSelected =
      current.activeSurface?.kind === 'browser' &&
      current.activeSurface.previewId === operation.request.previewId
    const restoreSelection = operation.request.activate && requestStillSelected
    return {
      groups: {
        ...state.groups,
        [operation.request.ownerKey]: {
          ...current,
          browserTabs: restoredTabs(operation, current.browserTabs),
          activeSurface: restoreSelection
            ? (previous?.activeSurface ?? null)
            : current.activeSurface,
          panelOpen:
            operation.request.visible && requestStillSelected
              ? (previous?.panelOpen ?? false)
              : current.panelOpen,
        },
      },
    }
  })
}

function rollbackFloatingState(operation: BrowserPreviewMaterializationOperation) {
  const ownerKey = operation.request.ownerKey
  useBrowserPreviewFloatingStore.setState((state) => {
    if (state.byOwnerKey[ownerKey]?.previewId !== operation.request.previewId) return state
    const byOwnerKey = { ...state.byOwnerKey }
    if (operation.previousFloating === undefined) delete byOwnerKey[ownerKey]
    else byOwnerKey[ownerKey] = operation.previousFloating
    return { byOwnerKey }
  })
}

async function rollbackNativeState(operation: BrowserPreviewMaterializationOperation) {
  if (operation.replacedPreviewState !== null) {
    const state = operation.replacedPreviewState
    clearBrowserPreviewExternalFallback(operation.request.previewId)
    await api
      .replaceBrowserPreviewForCapacity(
        {
          previewId: state.previewId,
          ownerKey: state.ownerKey,
          profileId: state.profileId,
          url: state.url,
          bounds: HIDDEN_BROWSER_PREVIEW_BOUNDS,
          visible: false,
          audioMuted: state.audioMuted,
          initialControls: {
            viewport: state.controls.viewport,
            zoomFactor: state.controls.zoomFactor,
            appearance: state.controls.appearance,
          },
        },
        operation.request.previewId,
      )
      .catch(() => undefined)
    return
  }
  const previousTab = operation.previousGroup?.browserTabs.find(
    (tab) => tab.id === operation.request.previewId,
  )
  if (!previousTab || previousTab.kind === 'launcher') {
    clearBrowserPreviewExternalFallback(operation.request.previewId)
    await api.closeBrowserPreview(operation.request.previewId).catch(() => undefined)
    return
  }
  if (previousTab.url !== operation.request.url) {
    await api
      .navigateBrowserPreview(operation.request.previewId, previousTab.url)
      .catch(() => undefined)
  }
}

export async function rollbackBrowserPreviewMaterialization(
  operation: BrowserPreviewMaterializationOperation,
  isLatest: IsLatestMaterialization,
) {
  if (!operation.mutatedRendererState || !isLatest(operation)) return
  rollbackWorkspaceState(operation)
  rollbackFloatingState(operation)
  await rollbackNativeState(operation)
}

export async function acknowledgeBrowserPreviewMaterialization(
  request: BrowserPreviewOpenRequest,
  success: boolean,
  error?: string,
) {
  const acknowledgment: BrowserPreviewOpenRequestAck = {
    requestId: request.requestId,
    generation: request.generation,
    ownerKey: request.ownerKey,
    previewId: request.previewId,
    success,
    ...(error === undefined ? {} : { error }),
  }
  await api.acknowledgeBrowserPreviewOpenRequest(acknowledgment)
}

export function validateBrowserPreviewMaterializationRequest(
  request: BrowserPreviewOpenRequest,
  registeredOwnerKeys: ReadonlySet<string>,
) {
  if (!registeredOwnerKeys.has(request.ownerKey)) {
    throw new Error('Browser preview owner is no longer registered.')
  }
  const normalizedUrl = normalizeBrowserPreviewUrl(request.url)
  if (normalizedUrl === null) throw new Error('Automation requested an invalid browser URL.')
  const settings = usePreferencesStore.getState().settings
  if (
    !resolveBrowserProfiles(settings.browserProfiles).some(
      (profile) => profile.id === request.profileId,
    )
  ) {
    throw new Error('Automation requested an unknown browser profile.')
  }
  return normalizedUrl
}
