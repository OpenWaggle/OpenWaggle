import { Camera, CircleStop, Crosshair, Loader2, Video } from 'lucide-react'
import { Button } from '@/shared/ui/Button'

interface BrowserPreviewCaptureControlsProps {
  readonly busy: 'screenshot' | 'pick' | null
  readonly picking: boolean
  readonly recording: boolean
  readonly onCaptureScreenshot: () => void
  readonly onPickElement: () => void
  readonly onToggleRecording: () => void
}

export function BrowserPreviewCaptureControls({
  busy,
  picking,
  recording,
  onCaptureScreenshot,
  onPickElement,
  onToggleRecording,
}: BrowserPreviewCaptureControlsProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      role="toolbar"
      aria-label="Browser capture controls"
    >
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Capture screenshot"
        title="Capture screenshot"
        disabled={busy !== null}
        onClick={onCaptureScreenshot}
      >
        {busy === 'screenshot' ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Camera className="size-3.5" />
        )}
      </Button>
      <Button
        size="icon-sm"
        variant={picking ? 'accent' : 'ghost'}
        aria-label={picking ? 'Cancel preview annotation' : 'Annotate preview for message'}
        aria-pressed={picking}
        title={picking ? 'Cancel preview annotation' : 'Annotate preview for message'}
        disabled={busy === 'screenshot'}
        onClick={onPickElement}
      >
        {busy === 'pick' ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Crosshair className="size-3.5" />
        )}
      </Button>
      <Button
        size="icon-sm"
        variant={recording ? 'danger' : 'ghost'}
        aria-label={recording ? 'Stop preview recording' : 'Start preview recording'}
        aria-pressed={recording}
        title={recording ? 'Stop preview recording' : 'Start preview recording (2 min maximum)'}
        disabled={busy !== null || picking}
        onClick={onToggleRecording}
      >
        {recording ? <CircleStop className="size-3.5" /> : <Video className="size-3.5" />}
      </Button>
    </div>
  )
}
