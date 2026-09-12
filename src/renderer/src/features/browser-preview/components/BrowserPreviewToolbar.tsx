import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  LockKeyhole,
  RefreshCw,
  X,
} from 'lucide-react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import type { BrowserPreviewTab } from '../browser-preview-model'
import type { BrowserPreviewAdvancedControls } from '../hooks/useBrowserPreviewAdvancedControls'
import type { BrowserPreviewControls } from '../hooks/useBrowserPreviewControls'
import { BrowserPreviewCaptureControls } from './BrowserPreviewCaptureControls'
import { BrowserPreviewMoreMenu } from './BrowserPreviewMoreMenu'

interface BrowserPreviewToolbarProps {
  readonly addressRef: React.RefObject<HTMLInputElement | null>
  readonly advanced: BrowserPreviewAdvancedControls
  readonly controls: BrowserPreviewControls
  readonly tab: BrowserPreviewTab
}

export function BrowserPreviewToolbar({
  addressRef,
  advanced,
  controls,
  tab,
}: BrowserPreviewToolbarProps) {
  const secure = tab.url.startsWith('https:')
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Back"
        title="Back"
        disabled={!tab.canGoBack}
        onClick={() =>
          controls.runControl(() => api.goBackBrowserPreview(tab.id), 'Preview could not go back.')
        }
      >
        <ArrowLeft className="size-3.5" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Forward"
        title="Forward"
        disabled={!tab.canGoForward}
        onClick={() =>
          controls.runControl(
            () => api.goForwardBrowserPreview(tab.id),
            'Preview could not go forward.',
          )
        }
      >
        <ArrowRight className="size-3.5" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={tab.loading ? 'Stop loading' : 'Reload'}
        title={tab.loading ? 'Stop loading' : 'Reload'}
        onClick={() =>
          controls.runControl(
            () => (tab.loading ? api.stopBrowserPreview(tab.id) : api.reloadBrowserPreview(tab.id)),
            'Preview could not reload.',
          )
        }
      >
        {tab.loading ? <X className="size-3.5" /> : <RefreshCw className="size-3.5" />}
      </Button>
      <form className="relative min-w-0 flex-1" onSubmit={controls.navigate}>
        {secure ? (
          <LockKeyhole className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-success" />
        ) : (
          <Globe2 className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-text-muted" />
        )}
        <input
          ref={addressRef}
          aria-label="Preview address"
          value={controls.address}
          spellCheck={false}
          className="h-7 w-full rounded border border-border bg-bg-secondary pr-2 pl-7 text-xs text-text-secondary outline-none focus:border-accent/60"
          onChange={(event) => controls.setAddress(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
        />
      </form>
      <BrowserPreviewCaptureControls
        busy={advanced.busy}
        picking={advanced.controlState.picking}
        recording={advanced.recording}
        onCaptureScreenshot={advanced.captureScreenshot}
        onPickElement={advanced.pickElement}
        onToggleRecording={advanced.toggleRecording}
      />
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Open in system browser"
        title="Open in system browser"
        onClick={() => void api.openExternal(tab.url)}
      >
        <ExternalLink className="size-3.5" />
      </Button>
      <BrowserPreviewMoreMenu advanced={advanced} />
    </div>
  )
}
