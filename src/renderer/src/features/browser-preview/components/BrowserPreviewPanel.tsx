import type { BrowserPreviewState } from '@shared/types/browser-preview'
import {
  type BrowserPreviewControlState,
  DEFAULT_BROWSER_PREVIEW_CONTROL_STATE,
} from '@shared/types/browser-preview-controls'
import { useCallback, useRef, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import type {
  BrowserPreviewMaterializedTab,
  BrowserPreviewPanelCallbacks,
  BrowserPreviewTab,
} from '../browser-preview-model'
import { useBrowserPreviewAdvancedControls } from '../hooks/useBrowserPreviewAdvancedControls'
import { useBrowserPreviewControls } from '../hooks/useBrowserPreviewControls'
import { useBrowserPreviewNativeView } from '../hooks/useBrowserPreviewNativeView'
import {
  browserPreviewBounds,
  browserPreviewSourceViewport,
  pageHasOccludingDialog,
} from '../lib/browser-preview-native-bounds'
import { useBrowserPreviewRecentStore } from '../state/browser-preview-recent-store'
import { BrowserPreviewDeviceToolbar } from './BrowserPreviewDeviceToolbar'
import { BrowserPreviewLauncher } from './BrowserPreviewLauncher'
import { BrowserPreviewPanelStatus } from './BrowserPreviewPanelStatus'
import { BrowserPreviewToolbar } from './BrowserPreviewToolbar'
import { BrowserPreviewViewport } from './BrowserPreviewViewport'

export interface BrowserPreviewPanelProps extends BrowserPreviewPanelCallbacks {
  readonly onFloat: () => void
  readonly tab: BrowserPreviewTab
}

function isMaterializedTab(tab: BrowserPreviewTab): tab is BrowserPreviewMaterializedTab {
  return tab.kind === 'preview'
}

function stateMatchesTab(
  state: BrowserPreviewState,
  previewId: string,
  ownerKey: string,
  profileId: string,
) {
  return (
    state.previewId === previewId && state.ownerKey === ownerKey && state.profileId === profileId
  )
}

/** Empty launcher until a destination is chosen, then a sandboxed native WebContentsView host. */
export function BrowserPreviewPanel(props: BrowserPreviewPanelProps) {
  if (!isMaterializedTab(props.tab)) {
    return (
      <BrowserPreviewLauncher
        tab={props.tab}
        onError={props.onError}
        onMaterialize={props.onMaterialize}
      />
    )
  }
  return <MaterializedBrowserPreviewPanel {...props} tab={props.tab} />
}

interface MaterializedBrowserPreviewPanelProps extends BrowserPreviewPanelCallbacks {
  readonly onFloat: () => void
  readonly tab: BrowserPreviewMaterializedTab
}

function MaterializedBrowserPreviewPanel({
  onClose,
  onError,
  onFloat,
  onUpdate,
  tab,
}: MaterializedBrowserPreviewPanelProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const [aspectRatio, setAspectRatio] = useState<number | null>(null)
  const [controlState, setControlState] = useState<BrowserPreviewControlState>(() => {
    const settings = usePreferencesStore.getState().settings
    return {
      ...DEFAULT_BROWSER_PREVIEW_CONTROL_STATE,
      viewport: settings.browserDefaultViewport,
      zoomFactor: settings.browserDefaultZoomFactor,
      appearance: settings.browserDefaultAppearance,
    }
  })
  const applyNativeState = useCallback(
    (state: BrowserPreviewState) => {
      if (!stateMatchesTab(state, tab.id, tab.ownerKey, tab.profileId)) return
      setControlState(state.controls)
      if (state.controls.viewport.mode === 'fill') setAspectRatio(null)
      const title = state.title || tab.title
      onUpdate({
        url: state.url,
        title,
        loading: state.loading,
        canGoBack: state.canGoBack,
        canGoForward: state.canGoForward,
        error: state.error?.description ?? null,
        audioMuted: state.audioMuted,
        audible: state.audible,
        favicon: state.favicon,
        controller: state.controller,
      })
      if (!state.loading && state.error === null) {
        useBrowserPreviewRecentStore.getState().remember({
          url: state.url,
          title,
          visitedAt: Date.now(),
        })
      }
      const viewport = viewportRef.current
      const bounds =
        state.error !== null || viewport === null || pageHasOccludingDialog(tab.ownerKey)
          ? null
          : browserPreviewBounds(viewport)
      void api.setBrowserPreviewBounds(tab.id, bounds).catch(() => undefined)
    },
    [onUpdate, tab.id, tab.ownerKey, tab.profileId, tab.title],
  )
  const nativeOptions = {
    addressRef,
    onClose,
    onError,
    onState: applyNativeState,
    tab,
    viewportRef,
  }
  useBrowserPreviewNativeView(nativeOptions)
  const controls = useBrowserPreviewControls({
    addressRef,
    onError,
    onState: applyNativeState,
    onUpdate,
    tab,
    viewportRef,
  })
  const advanced = useBrowserPreviewAdvancedControls({
    controlState,
    onError,
    onState: applyNativeState,
    previewId: tab.id,
    viewportRef,
  })

  return (
    <section
      className="flex size-full min-h-0 flex-col bg-bg"
      aria-label="Browser preview"
      data-browser-preview-panel
    >
      <BrowserPreviewToolbar
        addressRef={addressRef}
        advanced={advanced}
        controls={controls}
        tab={tab}
      />
      <BrowserPreviewPanelStatus
        tab={tab}
        onError={onError}
        onFloat={onFloat}
        onUpdate={onUpdate}
        getSourceViewport={() =>
          controlState.viewport.mode === 'fixed'
            ? controlState.viewport
            : browserPreviewSourceViewport(viewportRef.current, controlState.zoomFactor)
        }
      />
      {controlState.viewport.mode === 'fixed' ? (
        <BrowserPreviewDeviceToolbar
          aspectRatio={aspectRatio}
          viewport={controlState.viewport}
          onClose={() => advanced.setViewport({ mode: 'fill' })}
          onAspectRatioChange={setAspectRatio}
          onViewportChange={advanced.setViewport}
        />
      ) : null}
      <BrowserPreviewViewport
        aspectRatio={aspectRatio}
        controls={controlState}
        onRetry={controls.retry}
        onViewportChange={advanced.setViewport}
        tab={tab}
        viewportRef={viewportRef}
      />
    </section>
  )
}
