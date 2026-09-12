import {
  BROWSER_PREVIEW_VIEWPORT_PRESETS,
  browserPreviewPresetViewport,
} from '@shared/browser-preview-viewports'
import {
  BROWSER_PREVIEW_APPEARANCES,
  BROWSER_PREVIEW_RECORDING_FRAME_RATES,
  BROWSER_PREVIEW_ZOOM_FACTORS,
  type BrowserPreviewAppearance,
  type BrowserPreviewRecordingFrameRate,
  type BrowserPreviewViewport,
  type BrowserPreviewZoomFactor,
} from '@shared/types/browser-preview-controls'
import type { Settings } from '@shared/types/settings'
import { Select } from '@/shared/ui/Select'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'

const PERCENT_SCALE = 100

export interface BrowserPreviewDefaultActions {
  readonly setAppearance: (value: BrowserPreviewAppearance) => Promise<void>
  readonly setAutoShow: (value: boolean) => Promise<void>
  readonly setFrameRate: (value: BrowserPreviewRecordingFrameRate) => Promise<void>
  readonly setViewport: (value: BrowserPreviewViewport) => Promise<void>
  readonly setZoom: (value: BrowserPreviewZoomFactor) => Promise<void>
}

interface ControlsProps {
  readonly actions: BrowserPreviewDefaultActions
  readonly disabled: boolean
  readonly settings: Settings
  readonly update: (operation: () => Promise<void>) => void
}

function SettingRow(props: {
  readonly children: React.ReactNode
  readonly description: string
  readonly label: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 not-last:border-b not-last:border-border">
      <div className="min-w-0">
        <div className="text-xs font-medium text-text-primary">{props.label}</div>
        <div className="mt-0.5 text-xs text-text-tertiary">{props.description}</div>
      </div>
      <div className="shrink-0">{props.children}</div>
    </div>
  )
}

function viewportValue(viewport: BrowserPreviewViewport) {
  if (viewport.mode === 'fill') return 'fill'
  const preset = BROWSER_PREVIEW_VIEWPORT_PRESETS.find(
    (candidate) =>
      candidate.id === viewport.presetId &&
      candidate.width === viewport.width &&
      candidate.height === viewport.height,
  )
  return preset?.id ?? 'custom'
}

function ViewportControl({ actions, disabled, settings, update }: ControlsProps) {
  const currentValue = viewportValue(settings.browserDefaultViewport)
  return (
    <SettingRow label="Viewport" description="Initial device size for new tabs.">
      <Select
        aria-label="Default preview viewport"
        value={currentValue}
        disabled={disabled}
        onChange={(event) => {
          const value = event.currentTarget.value
          if (value === 'fill') {
            update(() => actions.setViewport({ mode: 'fill' }))
            return
          }
          const preset = BROWSER_PREVIEW_VIEWPORT_PRESETS.find(
            (candidate) => candidate.id === value,
          )
          if (preset !== undefined) {
            update(() => actions.setViewport(browserPreviewPresetViewport(preset.id)))
          }
        }}
      >
        <option value="fill">Fill available space</option>
        {settings.browserDefaultViewport.mode === 'fixed' && currentValue === 'custom' ? (
          <option value="custom" disabled>
            Custom ({settings.browserDefaultViewport.width} ×{' '}
            {settings.browserDefaultViewport.height})
          </option>
        ) : null}
        {BROWSER_PREVIEW_VIEWPORT_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label} ({preset.width} × {preset.height})
          </option>
        ))}
      </Select>
    </SettingRow>
  )
}

function ZoomControl({ actions, disabled, settings, update }: ControlsProps) {
  return (
    <SettingRow label="Zoom" description="Initial page scale for new tabs.">
      <Select
        aria-label="Default preview zoom"
        value={String(settings.browserDefaultZoomFactor)}
        disabled={disabled}
        onChange={(event) => {
          const factor = BROWSER_PREVIEW_ZOOM_FACTORS.find(
            (candidate) => String(candidate) === event.currentTarget.value,
          )
          if (factor !== undefined) update(() => actions.setZoom(factor))
        }}
      >
        {BROWSER_PREVIEW_ZOOM_FACTORS.map((factor) => (
          <option key={factor} value={String(factor)}>
            {Math.round(factor * PERCENT_SCALE)}%
          </option>
        ))}
      </Select>
    </SettingRow>
  )
}

function AppearanceControl({ actions, disabled, settings, update }: ControlsProps) {
  return (
    <SettingRow label="Appearance" description="Emulated colour scheme for page media queries.">
      <Select
        aria-label="Default preview appearance"
        value={settings.browserDefaultAppearance}
        disabled={disabled}
        onChange={(event) => {
          const appearance = BROWSER_PREVIEW_APPEARANCES.find(
            (candidate) => candidate === event.currentTarget.value,
          )
          if (appearance !== undefined) update(() => actions.setAppearance(appearance))
        }}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </Select>
    </SettingRow>
  )
}

function RecordingControl({ actions, disabled, settings, update }: ControlsProps) {
  return (
    <SettingRow label="Recording" description="Frames captured per second for preview recordings.">
      <Select
        aria-label="Preview recording frame rate"
        value={String(settings.browserRecordingFrameRate)}
        disabled={disabled}
        onChange={(event) => {
          const frameRate = BROWSER_PREVIEW_RECORDING_FRAME_RATES.find(
            (candidate) => String(candidate) === event.currentTarget.value,
          )
          if (frameRate !== undefined) update(() => actions.setFrameRate(frameRate))
        }}
      >
        {BROWSER_PREVIEW_RECORDING_FRAME_RATES.map((frameRate) => (
          <option key={frameRate} value={String(frameRate)}>
            {frameRate} FPS
          </option>
        ))}
      </Select>
    </SettingRow>
  )
}

function AutoShowControl({ actions, disabled, settings, update }: ControlsProps) {
  return (
    <SettingRow
      label="Show agent-opened previews"
      description="Show a floating preview when an agent opens it without an explicit choice."
    >
      <ToggleSwitch
        checked={settings.browserAutoShowFloatingPreview}
        disabled={disabled}
        label="Show agent-opened previews"
        onCheckedChange={(enabled) => update(() => actions.setAutoShow(enabled))}
      />
    </SettingRow>
  )
}

export function BrowserPreviewDefaultControls(props: ControlsProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <ViewportControl {...props} />
      <ZoomControl {...props} />
      <AppearanceControl {...props} />
      <RecordingControl {...props} />
      <AutoShowControl {...props} />
    </div>
  )
}
