import type { BrowserPreviewState } from '@shared/types/browser-preview'
import {
  type BrowserPreviewControlState,
  DEFAULT_BROWSER_PREVIEW_CONTROL_STATE,
} from '@shared/types/browser-preview-controls'
import { PanelRight, PictureInPicture2, X } from 'lucide-react'
import type { HTMLAttributes } from 'react'
import { useRef, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import type {
  BrowserPreviewMaterializedTab,
  BrowserPreviewTabPatch,
} from '../browser-preview-model'
import { useBrowserPreviewFloatingLayout } from '../hooks/useBrowserPreviewFloatingLayout'
import { useBrowserPreviewNativeView } from '../hooks/useBrowserPreviewNativeView'
import {
  selectBrowserPreviewFloating,
  useBrowserPreviewFloatingStore,
} from '../state/browser-preview-floating-store'
import { BrowserPreviewControllerBadge } from './BrowserPreviewControllerBadge'
import { BrowserPreviewFloatingResizeHandles } from './BrowserPreviewFloatingResizeHandles'
import { BrowserPreviewViewport } from './BrowserPreviewViewport'

const FALLBACK_SOURCE_SIZE = { width: 1_280, height: 800 } as const

interface BrowserPreviewFloatingPanelProps {
  readonly tab: BrowserPreviewMaterializedTab
  readonly onCloseBrowser: () => void
  readonly onError: (message: string) => void
  readonly onOpenInPanel: () => void
  readonly onUpdate: (patch: BrowserPreviewTabPatch) => void
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

interface FloatingHeaderProps {
  readonly controller: BrowserPreviewMaterializedTab['controller']
  readonly dragHandlers: HTMLAttributes<HTMLElement>
  readonly pictureInPicture: boolean
  readonly resizeHandlers: HTMLAttributes<HTMLElement>
  readonly title: string
  readonly onClose: () => void
  readonly onOpenInPanel: () => void
  readonly onTogglePictureInPicture: () => void
}

function FloatingHeader({
  controller,
  dragHandlers,
  onClose,
  onOpenInPanel,
  onTogglePictureInPicture,
  pictureInPicture,
  resizeHandlers,
  title,
}: FloatingHeaderProps) {
  return (
    <div
      className="flex h-7 shrink-0 cursor-grab items-center gap-1 border-b border-border/70 bg-bg-secondary/95 px-1.5 active:cursor-grabbing"
      {...dragHandlers}
    >
      <BrowserPreviewControllerBadge controller={controller} />
      <span className="min-w-0 flex-1 truncate px-1 text-xs text-text-muted">{title}</span>
      <div
        className="flex items-center gap-0.5 opacity-45 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Open preview in right panel"
          title="Open in right panel"
          onClick={onOpenInPanel}
        >
          <PanelRight className="size-3" />
        </Button>
        <Button
          size="icon-xs"
          variant={pictureInPicture ? 'subtle' : 'ghost'}
          aria-label={
            pictureInPicture ? 'Close popped-out preview' : 'Pop preview into separate window'
          }
          title={pictureInPicture ? 'Close separate window' : 'Pop into separate window'}
          onClick={onTogglePictureInPicture}
        >
          <PictureInPicture2 className="size-3" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Close floating preview"
          title="Close floating preview"
          onClick={onClose}
        >
          <X className="size-3" />
        </Button>
        <Button
          variant="unstyled"
          aria-label="Resize floating preview"
          title="Resize floating preview"
          className="relative size-5 cursor-nwse-resize rounded after:absolute after:right-1 after:bottom-1 after:size-2 after:border-r after:border-b after:border-text-muted/70 hover:bg-bg-hover"
          {...resizeHandlers}
        />
      </div>
    </div>
  )
}

/** Compact chat overlay that relocates the Session's existing native preview. */
export function BrowserPreviewFloatingPanel({
  onCloseBrowser,
  onError,
  onOpenInPanel,
  onUpdate,
  tab,
}: BrowserPreviewFloatingPanelProps) {
  const floating = useBrowserPreviewFloatingStore((state) =>
    selectBrowserPreviewFloating(state.byOwnerKey, tab.ownerKey),
  )
  const viewportRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const [controlState, setControlState] = useState<BrowserPreviewControlState>(() => {
    const settings = usePreferencesStore.getState().settings
    return {
      ...DEFAULT_BROWSER_PREVIEW_CONTROL_STATE,
      viewport: settings.browserDefaultViewport,
      zoomFactor: settings.browserDefaultZoomFactor,
      appearance: settings.browserDefaultAppearance,
    }
  })
  const sourceViewport =
    controlState.viewport.mode === 'fill' ? floating?.sourceViewport : undefined
  const viewport =
    controlState.viewport.mode === 'fixed'
      ? controlState.viewport
      : (sourceViewport ?? FALLBACK_SOURCE_SIZE)

  const applyNativeState = (state: BrowserPreviewState) => {
    if (
      state.previewId !== tab.id ||
      state.ownerKey !== tab.ownerKey ||
      state.profileId !== tab.profileId
    ) {
      return
    }
    setControlState(state.controls)
    onUpdate({
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
  const nativeReady = useBrowserPreviewNativeView({
    addressRef,
    onClose: onCloseBrowser,
    onError,
    onState: applyNativeState,
    tab,
    viewportRef,
    sourceViewport,
  })

  const layout = useBrowserPreviewFloatingLayout({
    ownerKey: tab.ownerKey,
    previewId: tab.id,
    position: floating?.previewId === tab.id ? floating.position : null,
    size: floating?.previewId === tab.id ? floating.size : null,
    visible: tab.error === null,
    nativeReady,
    sourceViewport,
    sourceSize: {
      width: viewport.width * controlState.zoomFactor,
      height: viewport.height * controlState.zoomFactor,
    },
  })

  const retry = () => {
    void api
      .reloadBrowserPreview(tab.id)
      .then(applyNativeState)
      .catch((error: unknown) => onError(errorMessage(error, 'Preview could not reload.')))
  }
  const toggleNativePictureInPicture = () => {
    const operation = controlState.pictureInPicture
      ? api.closeBrowserPreviewPictureInPicture(tab.id)
      : api.openBrowserPreviewPictureInPicture(tab.id)
    void operation
      .then(applyNativeState)
      .catch((error: unknown) =>
        onError(errorMessage(error, 'Picture-in-picture could not change.')),
      )
  }
  const closeFloating = () => useBrowserPreviewFloatingStore.getState().close(tab.ownerKey, tab.id)
  const openInPanel = () => {
    closeFloating()
    onOpenInPanel()
  }

  return (
    <section
      ref={layout.rootRef}
      aria-label="Floating browser preview"
      className="group pointer-events-auto absolute z-40 flex min-h-0 select-none flex-col rounded-lg border border-border/80 bg-bg p-1 shadow-2xl"
      data-browser-preview-floating={tab.id}
      style={layout.style}
    >
      <FloatingHeader
        controller={tab.controller}
        dragHandlers={layout.dragHandlers}
        pictureInPicture={controlState.pictureInPicture}
        resizeHandlers={layout.resizeHandlers('southeast')}
        title={tab.title}
        onClose={closeFloating}
        onOpenInPanel={openInPanel}
        onTogglePictureInPicture={toggleNativePictureInPicture}
      />
      <BrowserPreviewViewport
        controls={controlState}
        onRetry={retry}
        tab={tab}
        viewportRef={viewportRef}
      />
      <BrowserPreviewFloatingResizeHandles handlers={layout.resizeHandlers} />
    </section>
  )
}
