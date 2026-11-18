import {
  BROWSER_PREVIEW_VIEWPORT_MAX_AREA,
  BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
  BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION,
  BROWSER_PREVIEW_VIEWPORT_PRESETS,
  browserPreviewPresetViewport,
  rotateBrowserPreviewViewport,
} from '@shared/browser-preview-viewports'
import type { BrowserPreviewFixedViewport } from '@shared/types/browser-preview-controls'
import { Link2, RotateCw, Unlink2, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { NumberStepper } from '@/shared/ui/NumberStepper'
import { Select } from '@/shared/ui/Select'
import { resizeBrowserPreviewViewport } from '../lib/browser-preview-viewport-actions'

interface BrowserPreviewDeviceToolbarProps {
  readonly aspectRatio: number | null
  readonly viewport: BrowserPreviewFixedViewport
  readonly onClose: () => void
  readonly onAspectRatioChange: (aspectRatio: number | null) => void
  readonly onViewportChange: (viewport: BrowserPreviewFixedViewport) => void
}

function maximumDimension(otherDimension: number) {
  return Math.min(
    BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION,
    Math.floor(BROWSER_PREVIEW_VIEWPORT_MAX_AREA / otherDimension),
  )
}

export function BrowserPreviewDeviceToolbar({
  aspectRatio,
  viewport,
  onClose,
  onAspectRatioChange,
  onViewportChange,
}: BrowserPreviewDeviceToolbarProps) {
  const selectPreset = (value: string) => {
    if (value === 'responsive') {
      onViewportChange({ ...viewport, presetId: null })
      return
    }
    const preset = BROWSER_PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.id === value)
    if (preset === undefined) return
    if (aspectRatio !== null) onAspectRatioChange(preset.width / preset.height)
    onViewportChange(browserPreviewPresetViewport(preset.id))
  }
  const setDimension = (dimension: 'width' | 'height', value: number) => {
    const delta =
      dimension === 'width'
        ? { x: value - viewport.width, y: 0 }
        : { x: 0, y: value - viewport.height }
    const next = resizeBrowserPreviewViewport(
      viewport,
      delta,
      1,
      dimension === 'width' ? 'east' : 'south',
      aspectRatio,
    )
    onViewportChange({ mode: 'fixed', ...next, presetId: null })
  }
  const rotate = () => {
    onViewportChange(rotateBrowserPreviewViewport(viewport))
    if (aspectRatio !== null) onAspectRatioChange(1 / aspectRatio)
  }

  return (
    <div
      className="flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-bg-secondary px-2"
      role="toolbar"
      aria-label="Device viewport controls"
    >
      <Select
        aria-label="Device preset"
        selectSize="xs"
        className="w-40 shrink-0"
        value={viewport.presetId ?? 'responsive'}
        onChange={(event) => selectPreset(event.currentTarget.value)}
      >
        <option value="responsive">Responsive</option>
        {BROWSER_PREVIEW_VIEWPORT_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label} ({preset.width} × {preset.height})
          </option>
        ))}
      </Select>
      <NumberStepper
        label="viewport width"
        value={viewport.width}
        minimum={BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION}
        maximum={maximumDimension(viewport.height)}
        suffix="px"
        onValueChange={(value) => setDimension('width', value)}
      />
      <span className="shrink-0 text-xs text-text-muted" aria-hidden="true">
        ×
      </span>
      <NumberStepper
        label="viewport height"
        value={viewport.height}
        minimum={BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION}
        maximum={maximumDimension(viewport.width)}
        suffix="px"
        onValueChange={(value) => setDimension('height', value)}
      />
      <Button
        size="icon-sm"
        variant={aspectRatio === null ? 'ghost' : 'subtle'}
        aria-label={aspectRatio === null ? 'Lock aspect ratio' : 'Unlock aspect ratio'}
        aria-pressed={aspectRatio !== null}
        title={aspectRatio === null ? 'Lock aspect ratio' : 'Unlock aspect ratio'}
        onClick={() =>
          onAspectRatioChange(aspectRatio === null ? viewport.width / viewport.height : null)
        }
      >
        {aspectRatio === null ? <Unlink2 className="size-3.5" /> : <Link2 className="size-3.5" />}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Rotate viewport"
        title="Rotate viewport"
        onClick={rotate}
      >
        <RotateCw className="size-3.5" />
      </Button>
      <div className="min-w-1 flex-1" />
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Close device toolbar"
        title="Close device toolbar"
        onClick={onClose}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}
