import type { BrowserPreviewState } from '@shared/types/browser-preview'
import type {
  BrowserPreviewOpenRequest,
  BrowserPreviewOpenRequestCancellation,
} from '@shared/types/browser-preview-owner'
import {
  clearBrowserPreviewExternalFallback,
  HIDDEN_BROWSER_PREVIEW_BOUNDS,
  useBrowserPreviewFloatingStore,
} from '@/features/browser-preview'
import { usePreferencesStore } from '@/features/settings/state'
import {
  drainBrowserPreviewOwnerWork,
  trackBrowserPreviewOwnerWork,
} from '@/shared/lib/browser-preview-owner-work'
import { api } from '@/shared/lib/ipc'
import {
  isWorkspaceOwnerHandoffPending,
  WORKSPACE_OWNER_HANDOFF_MESSAGE,
} from '@/shared/lib/workspace-owner-handoff'
import {
  acknowledgeBrowserPreviewMaterialization,
  type BrowserPreviewMaterializationOperation,
  createBrowserPreviewMaterializationOperation,
  rollbackBrowserPreviewMaterialization,
  shouldRollbackBrowserPreviewMaterialization,
  validateBrowserPreviewMaterializationRequest,
} from './browser-preview-owner-materialization'
import {
  boundedBrowserPreviewOwnerError,
  browserPreviewOwnerKey,
} from './browser-preview-owner-runtime-policy'
import { waitForBrowserPreviewPresentation } from './browser-preview-presentation'
import { useUIStore } from './ui-store'
import { useWorkspacePanelStore } from './workspace-panel-store'

const MAX_TRACKED_REQUESTS = 512

const registeredOwnerKeys = new Set<string>()
const registrationByOwnerKey = new Map<string, Promise<void>>()
const operationByRequestId = new Map<string, BrowserPreviewMaterializationOperation>()
const latestGenerationByPreview = new Map<string, number>()
const canceledBeforeStart = new Map<string, BrowserPreviewOpenRequestCancellation>()
const ownerQueues = new Map<string, Promise<void>>()
let listenersInstalled = false

function recordLatestGeneration(key: string, generation: number) {
  if (
    !latestGenerationByPreview.has(key) &&
    latestGenerationByPreview.size >= MAX_TRACKED_REQUESTS
  ) {
    const oldest = latestGenerationByPreview.keys().next().value
    if (oldest !== undefined) latestGenerationByPreview.delete(oldest)
  }
  latestGenerationByPreview.set(key, generation)
}

function isLatest(operation: BrowserPreviewMaterializationOperation) {
  const { ownerKey, previewId, generation } = operation.request
  const latest = latestGenerationByPreview.get(browserPreviewOwnerKey(ownerKey, previewId))
  return latest === generation || (latest === undefined && !registeredOwnerKeys.has(ownerKey))
}

async function openRequestedNativePreview(
  operation: BrowserPreviewMaterializationOperation,
  url: string,
) {
  const { request } = operation
  const settings = usePreferencesStore.getState().settings
  const requestedTab = useWorkspacePanelStore
    .getState()
    .groups[request.ownerKey]?.browserTabs.find((tab) => tab.id === request.previewId)
  const input = {
    previewId: request.previewId,
    ownerKey: request.ownerKey,
    profileId: request.profileId,
    url,
    bounds: HIDDEN_BROWSER_PREVIEW_BOUNDS,
    visible: false,
    audioMuted: requestedTab?.audioMuted ?? false,
    initialControls: {
      viewport: settings.browserDefaultViewport,
      zoomFactor: settings.browserDefaultZoomFactor,
      appearance: settings.browserDefaultAppearance,
    },
  } as const
  if (operation.evictedPreviewId === null) return api.openBrowserPreview(input)
  const result = await api.replaceBrowserPreviewForCapacity(input, operation.evictedPreviewId)
  operation.replacedPreviewState = result.replacedState
  return result.state
}

function synchronizeBrowserPreviewTab(state: BrowserPreviewState) {
  const group = useWorkspacePanelStore.getState().groups[state.ownerKey]
  const tab = group?.browserTabs.find((candidate) => candidate.id === state.previewId)
  if (tab === undefined || tab.profileId !== state.profileId) return
  useWorkspacePanelStore.getState().updateBrowser(state.ownerKey, state.previewId, {
    url: state.url,
    title: state.title || tab.title,
    loading: state.loading,
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    error: state.error?.description ?? null,
    audioMuted: state.audioMuted,
    audible: state.audible,
    favicon: state.favicon,
    controller: state.controller,
  })
}

export function materializeRequestedPreview(request: BrowserPreviewOpenRequest) {
  if (isWorkspaceOwnerHandoffPending(request.ownerKey)) {
    return acknowledgeBrowserPreviewMaterialization(
      request,
      false,
      WORKSPACE_OWNER_HANDOFF_MESSAGE,
    ).catch(() => undefined)
  }
  return trackBrowserPreviewOwnerWork(request.ownerKey, () => materializePreview(request))
}

async function materializePreview(request: BrowserPreviewOpenRequest) {
  const key = browserPreviewOwnerKey(request.ownerKey, request.previewId)
  const currentGeneration = latestGenerationByPreview.get(key)
  if (currentGeneration !== undefined && request.generation < currentGeneration) {
    await acknowledgeBrowserPreviewMaterialization(
      request,
      false,
      'Browser preview request is stale.',
    ).catch(() => undefined)
    return
  }
  recordLatestGeneration(key, request.generation)
  const operation = createBrowserPreviewMaterializationOperation(request)
  operationByRequestId.set(request.requestId, operation)

  try {
    const normalizedUrl = validateBrowserPreviewMaterializationRequest(request, registeredOwnerKeys)
    const store = useWorkspacePanelStore.getState()
    const result = store.upsertBrowserRequest({ ...request, url: normalizedUrl })
    operation.evictedPreviewId = result.evictedPreviewId
    operation.mutatedRendererState = true
    if (shouldRollbackBrowserPreviewMaterialization(operation, isLatest)) {
      await rollbackBrowserPreviewMaterialization(operation, isLatest)
      return
    }

    const state = await openRequestedNativePreview(operation, normalizedUrl)
    if (shouldRollbackBrowserPreviewMaterialization(operation, isLatest)) {
      await rollbackBrowserPreviewMaterialization(operation, isLatest)
      return
    }

    useWorkspacePanelStore.getState().updateBrowser(request.ownerKey, request.previewId, {
      url: state.url,
      title: state.title || normalizedUrl,
      loading: state.loading,
      canGoBack: state.canGoBack,
      canGoForward: state.canGoForward,
      error: state.error?.description ?? null,
      audioMuted: state.audioMuted,
      audible: state.audible,
      favicon: state.favicon,
      controller: state.controller,
    })
    if (request.visible) {
      useBrowserPreviewFloatingStore.getState().open(request.ownerKey, request.previewId)
      await waitForBrowserPreviewPresentation(request.previewId)
    }
    if (shouldRollbackBrowserPreviewMaterialization(operation, isLatest)) {
      await rollbackBrowserPreviewMaterialization(operation, isLatest)
      return
    }
    await acknowledgeBrowserPreviewMaterialization(request, true)
    if (shouldRollbackBrowserPreviewMaterialization(operation, isLatest)) {
      await rollbackBrowserPreviewMaterialization(operation, isLatest)
      return
    }
    if (operation.evictedPreviewId !== null) {
      useBrowserPreviewFloatingStore
        .getState()
        .removePreview(request.ownerKey, operation.evictedPreviewId)
      clearBrowserPreviewExternalFallback(operation.evictedPreviewId)
    }
  } catch (error) {
    await rollbackBrowserPreviewMaterialization(operation, isLatest)
    if (shouldRollbackBrowserPreviewMaterialization(operation, isLatest)) return
    const message = boundedBrowserPreviewOwnerError(error)
    await acknowledgeBrowserPreviewMaterialization(request, false, message).catch(() => undefined)
    useWorkspacePanelStore
      .getState()
      .updateBrowser(request.ownerKey, request.previewId, { loading: false, error: message })
    useUIStore.getState().showToast(message, 'error')
  } finally {
    if (operationByRequestId.get(request.requestId) === operation) {
      operationByRequestId.delete(request.requestId)
    }
  }
}

export function cancelRequestedPreview(cancellation: BrowserPreviewOpenRequestCancellation) {
  if (!registeredOwnerKeys.has(cancellation.ownerKey)) return
  const operation = operationByRequestId.get(cancellation.requestId)
  if (
    operation &&
    operation.request.ownerKey === cancellation.ownerKey &&
    operation.request.previewId === cancellation.previewId &&
    operation.request.generation === cancellation.generation
  ) {
    operation.canceled = true
    return
  }
  if (canceledBeforeStart.size >= MAX_TRACKED_REQUESTS) {
    const oldest = canceledBeforeStart.keys().next().value
    if (oldest !== undefined) canceledBeforeStart.delete(oldest)
  }
  canceledBeforeStart.set(cancellation.requestId, cancellation)
}

function scheduleRequest(request: BrowserPreviewOpenRequest) {
  if (
    !registeredOwnerKeys.has(request.ownerKey) ||
    isWorkspaceOwnerHandoffPending(request.ownerKey)
  ) {
    void acknowledgeBrowserPreviewMaterialization(
      request,
      false,
      'Browser preview owner is unavailable or moving into a Session.',
    ).catch(() => undefined)
    return
  }
  const key = browserPreviewOwnerKey(request.ownerKey, request.previewId)
  const latest = latestGenerationByPreview.get(key)
  if (latest !== undefined && request.generation <= latest) {
    void acknowledgeBrowserPreviewMaterialization(
      request,
      false,
      'Browser preview request is stale.',
    ).catch(() => undefined)
    return
  }
  recordLatestGeneration(key, request.generation)
  const previousQueue = ownerQueues.get(request.ownerKey) ?? Promise.resolve()
  const nextQueue = previousQueue
    .catch(() => undefined)
    .then(async () => {
      const cancellation = canceledBeforeStart.get(request.requestId)
      if (cancellation) {
        canceledBeforeStart.delete(request.requestId)
        return
      }
      await materializeRequestedPreview(request)
    })
  ownerQueues.set(request.ownerKey, nextQueue)
  void nextQueue.finally(() => {
    if (ownerQueues.get(request.ownerKey) === nextQueue) ownerQueues.delete(request.ownerKey)
  })
}

function installListeners() {
  if (listenersInstalled) return
  listenersInstalled = true
  api.onBrowserPreviewState(synchronizeBrowserPreviewTab)
  api.onBrowserPreviewOpenRequest(scheduleRequest)
  api.onBrowserPreviewOpenRequestCancellation(cancelRequestedPreview)
}

export function ensureBrowserPreviewOwnerRegistered(ownerKey: string): Promise<void> {
  if (ownerKey.length === 0) return Promise.resolve()
  installListeners()
  const existing = registrationByOwnerKey.get(ownerKey)
  if (existing) return existing
  registeredOwnerKeys.add(ownerKey)
  const registration = api.registerBrowserPreviewOwner(ownerKey).catch((error: unknown) => {
    registeredOwnerKeys.delete(ownerKey)
    registrationByOwnerKey.delete(ownerKey)
    throw error
  })
  registrationByOwnerKey.set(ownerKey, registration)
  return registration
}

export function hasPendingBrowserPreviewOwnerWork(ownerKey: string) {
  return (
    ownerQueues.has(ownerKey) ||
    [...operationByRequestId.values()].some((operation) => operation.request.ownerKey === ownerKey)
  )
}

export function quiesceBrowserPreviewOwnerForHandoff(ownerKey: string) {
  return drainBrowserPreviewOwnerWork(ownerKey, ownerQueues.get(ownerKey))
}

export async function unregisterBrowserPreviewOwner(ownerKey: string): Promise<void> {
  if (ownerKey.length === 0) return
  registeredOwnerKeys.delete(ownerKey)
  for (const [requestId, operation] of operationByRequestId) {
    if (operation.request.ownerKey !== ownerKey) continue
    operation.canceled = true
    operationByRequestId.delete(requestId)
  }
  for (const key of latestGenerationByPreview.keys()) {
    if (key.startsWith(`${ownerKey}\0`)) latestGenerationByPreview.delete(key)
  }
  const registration = registrationByOwnerKey.get(ownerKey)
  registrationByOwnerKey.delete(ownerKey)
  await registration?.catch(() => undefined)
  await api.unregisterBrowserPreviewOwner(ownerKey).catch(() => undefined)
}
