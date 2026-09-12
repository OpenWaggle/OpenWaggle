import type { BrowserPreviewState } from '@shared/types/browser-preview'
import type {
  BrowserPreviewAppearance,
  BrowserPreviewControlState,
  BrowserPreviewViewport,
} from '@shared/types/browser-preview-controls'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'
import {
  activeBrowserPreviewComposerDraft,
  appendBrowserPreviewAnnotationToComposer,
} from '../lib/browser-preview-composer'
import { responsiveBrowserPreviewViewport } from '../lib/browser-preview-device-layout'
import { BrowserPreviewRecordingController } from '../lib/browser-preview-recording-controller'
import { BrowserPreviewRecordingRequestClient } from '../lib/browser-preview-recording-request-client'

type CaptureBusy = 'screenshot' | 'pick' | null

const FALLBACK_VIEWPORT_WIDTH = 800
const FALLBACK_VIEWPORT_HEIGHT = 600

interface AdvancedControlOptions {
  readonly onError: (message: string) => void
  readonly onState: (state: BrowserPreviewState) => void
  readonly controlState: BrowserPreviewControlState
  readonly previewId: string
  readonly viewportRef: React.RefObject<HTMLDivElement | null>
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function useBrowserPreviewAdvancedControls(options: AdvancedControlOptions) {
  const [busy, setBusy] = useState<CaptureBusy>(null)
  const recordingFrameRate = usePreferencesStore(
    (state) => state.settings.browserRecordingFrameRate,
  )
  const showToast = useUIStore((state) => state.showToast)
  const showPersistentToast = useUIStore((state) => state.showPersistentToast)
  const recording = useMemo(
    () =>
      new BrowserPreviewRecordingController(
        {
          begin: (previewId) => api.startBrowserPreviewRecording(previewId),
          save: (input) => api.saveBrowserPreviewRecording(input),
          finish: (previewId) => api.stopBrowserPreviewRecording(previewId),
        },
        undefined,
        recordingFrameRate,
      ),
    [recordingFrameRate],
  )
  const recordingSnapshot = useSyncExternalStore(
    recording.subscribe,
    recording.getSnapshot,
    recording.getSnapshot,
  )
  useEffect(() => {
    const client = new BrowserPreviewRecordingRequestClient(
      options.previewId,
      recording,
      (response) => api.respondBrowserPreviewRecordingRequest(response),
    )
    const removeRequestListener = api.onBrowserPreviewRecordingRequest((request) => {
      void client.handle(request).catch(() => undefined)
    })
    const removeCancelListener = api.onBrowserPreviewRecordingCancel((request) => {
      void client.cancel(request).catch(() => undefined)
    })
    return () => {
      removeRequestListener()
      removeCancelListener()
      void client.dispose()
    }
  }, [options.previewId, recording])

  const runState = useCallback(
    (action: () => Promise<BrowserPreviewState>, fallback: string) => {
      return action()
        .then(options.onState)
        .catch((error: unknown) => {
          options.onError(errorMessage(error, fallback))
        })
    },
    [options.onError, options.onState],
  )
  const runVoid = useCallback(
    (action: () => Promise<void>, fallback: string, success?: string) => {
      void action()
        .then(() => {
          if (success !== undefined) showToast(success, 'success')
        })
        .catch((error: unknown) => options.onError(errorMessage(error, fallback)))
    },
    [options.onError, showToast],
  )

  const setViewport = (viewport: BrowserPreviewViewport) =>
    runState(
      () => api.setBrowserPreviewViewport(options.previewId, viewport),
      'Preview viewport could not change.',
    )
  const setAppearance = (appearance: BrowserPreviewAppearance) =>
    runState(
      () => api.setBrowserPreviewAppearance(options.previewId, appearance),
      'Preview appearance could not change.',
    )
  const zoom = (action: 'in' | 'out' | 'reset') => {
    void api.zoomBrowserPreview(options.previewId, action).catch((error: unknown) => {
      options.onError(errorMessage(error, 'Preview zoom could not change.'))
    })
  }
  const captureScreenshot = () => {
    if (busy !== null) return
    setBusy('screenshot')
    void api
      .captureBrowserPreviewScreenshot(options.previewId)
      .then(async (artifact) => {
        await api.copyBrowserPreviewScreenshot(artifact.path)
        showPersistentToast({
          message: 'Screenshot copied to the clipboard.',
          variant: 'success',
          action: {
            label: 'Reveal file',
            onClick: () => void api.revealBrowserPreviewArtifact(artifact.path),
          },
        })
      })
      .catch((error: unknown) =>
        options.onError(errorMessage(error, 'Preview screenshot could not be captured.')),
      )
      .finally(() => setBusy(null))
  }
  const pickElement = () => {
    if (options.controlState.picking) {
      runVoid(
        () => api.cancelBrowserPreviewElementPick(options.previewId),
        'Preview annotation could not be cancelled.',
      )
      return
    }
    if (busy !== null) return
    const draft = activeBrowserPreviewComposerDraft()
    setBusy('pick')
    void api
      .pickBrowserPreviewElement(options.previewId)
      .then((annotation) => {
        if (annotation === null) return
        appendBrowserPreviewAnnotationToComposer(annotation, draft)
        showToast('Preview annotation attached to your message.', 'success')
      })
      .catch((error: unknown) =>
        options.onError(errorMessage(error, 'Preview annotation could not be attached.')),
      )
      .finally(() => setBusy(null))
  }
  const toggleRecording = () => {
    if (recordingSnapshot.phase === 'recording' || recordingSnapshot.phase === 'stopping') {
      void recording
        .stop()
        .then((artifact) => {
          if (artifact === null) return
          showPersistentToast({
            message: 'Preview recording saved.',
            variant: 'success',
            action: {
              label: 'Reveal file',
              onClick: () => void api.revealBrowserPreviewArtifact(artifact.path),
            },
          })
        })
        .catch((error: unknown) =>
          options.onError(errorMessage(error, 'Preview recording could not be saved.')),
        )
      return
    }
    if (recordingSnapshot.phase === 'starting') return
    recording.clearResult()
    void recording.start(options.previewId).catch((error: unknown) => {
      options.onError(errorMessage(error, 'Preview recording could not start.'))
    })
  }

  return {
    busy,
    recording: ['starting', 'recording', 'stopping'].includes(recordingSnapshot.phase),
    captureScreenshot,
    pickElement,
    toggleRecording,
    controlState: options.controlState,
    setViewport,
    setAppearance,
    zoom,
    toggleDeviceToolbar: () => {
      if (options.controlState.viewport.mode === 'fixed') {
        setViewport({ mode: 'fill' })
        return
      }
      const bounds = options.viewportRef.current?.getBoundingClientRect()
      setViewport(
        responsiveBrowserPreviewViewport(
          {
            width: bounds?.width ?? FALLBACK_VIEWPORT_WIDTH,
            height: bounds?.height ?? FALLBACK_VIEWPORT_HEIGHT,
          },
          options.controlState.zoomFactor,
        ),
      )
    },
    hardReload: () =>
      runState(
        () => api.hardReloadBrowserPreview(options.previewId),
        'Preview could not hard reload.',
      ),
    openDevTools: () =>
      runVoid(
        () => api.openBrowserPreviewDevTools(options.previewId),
        'Preview DevTools could not open.',
      ),
    clearCookies: () =>
      runVoid(
        () => api.clearBrowserPreviewCookies(options.previewId),
        'Preview cookies could not be cleared.',
        'Preview cookies cleared.',
      ),
    clearCache: () =>
      runVoid(
        () => api.clearBrowserPreviewCache(options.previewId),
        'Preview cache could not be cleared.',
        'Preview cache cleared.',
      ),
    togglePictureInPicture: () =>
      runState(
        () =>
          options.controlState.pictureInPicture
            ? api.closeBrowserPreviewPictureInPicture(options.previewId)
            : api.openBrowserPreviewPictureInPicture(options.previewId),
        'Picture-in-picture could not change.',
      ),
  }
}

export type BrowserPreviewAdvancedControls = ReturnType<typeof useBrowserPreviewAdvancedControls>
