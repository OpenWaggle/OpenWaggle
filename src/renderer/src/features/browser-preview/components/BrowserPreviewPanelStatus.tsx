import { PictureInPicture2 } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import type {
  BrowserPreviewMaterializedTab,
  BrowserPreviewPanelCallbacks,
} from '../browser-preview-model'
import type { BrowserPreviewFloatingSize } from '../state/browser-preview-floating-store'
import {
  selectBrowserPreviewFloating,
  useBrowserPreviewFloatingStore,
} from '../state/browser-preview-floating-store'
import { BrowserPreviewControllerBadge } from './BrowserPreviewControllerBadge'
import { BrowserPreviewProfileSelector } from './BrowserPreviewProfileSelector'

interface BrowserPreviewPanelStatusProps
  extends Pick<BrowserPreviewPanelCallbacks, 'onError' | 'onUpdate'> {
  readonly onFloat: () => void
  readonly tab: BrowserPreviewMaterializedTab
  readonly getSourceViewport: () => BrowserPreviewFloatingSize | undefined
}

/** Persistent identity and placement controls outside the native guest surface. */
export function BrowserPreviewPanelStatus({
  onError,
  onFloat,
  onUpdate,
  tab,
  getSourceViewport,
}: BrowserPreviewPanelStatusProps) {
  const floating = useBrowserPreviewFloatingStore(
    (state) => selectBrowserPreviewFloating(state.byOwnerKey, tab.ownerKey)?.previewId === tab.id,
  )
  const toggleFloating = () => {
    const store = useBrowserPreviewFloatingStore.getState()
    if (floating) {
      store.close(tab.ownerKey, tab.id)
      return
    }
    store.open(tab.ownerKey, tab.id, getSourceViewport())
    onFloat()
  }
  const label = floating ? 'Close floating preview' : 'Float preview over chat'

  return (
    <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-2">
      <BrowserPreviewControllerBadge controller={tab.controller} />
      <div className="min-w-0 flex-1" />
      <Button
        size="icon-sm"
        variant={floating ? 'subtle' : 'ghost'}
        aria-label={label}
        aria-pressed={floating}
        title={label}
        onClick={toggleFloating}
      >
        <PictureInPicture2 className={floating ? 'size-3.5 text-accent' : 'size-3.5'} />
      </Button>
      <BrowserPreviewProfileSelector tab={tab} onError={onError} onUpdate={onUpdate} />
    </div>
  )
}
