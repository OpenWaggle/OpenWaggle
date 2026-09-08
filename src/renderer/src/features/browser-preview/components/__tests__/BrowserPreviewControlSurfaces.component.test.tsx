import {
  type BrowserPreviewControlState,
  type BrowserPreviewFixedViewport,
  DEFAULT_BROWSER_PREVIEW_CONTROL_STATE,
} from '@shared/types/browser-preview-controls'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserPreviewAdvancedControls } from '../../hooks/useBrowserPreviewAdvancedControls'
import { BrowserPreviewCaptureControls } from '../BrowserPreviewCaptureControls'
import { BrowserPreviewDeviceToolbar } from '../BrowserPreviewDeviceToolbar'
import { BrowserPreviewMoreMenu } from '../BrowserPreviewMoreMenu'

const IPHONE_VIEWPORT = {
  mode: 'fixed',
  width: 390,
  height: 844,
  presetId: 'iphone-12-pro',
} as const

function DeviceToolbarHarness({
  onViewportChange,
}: {
  readonly onViewportChange: (viewport: BrowserPreviewFixedViewport) => void
}) {
  const [viewport, setViewport] = useState<BrowserPreviewFixedViewport>(IPHONE_VIEWPORT)
  const [aspectRatio, setAspectRatio] = useState<number | null>(null)
  return (
    <BrowserPreviewDeviceToolbar
      aspectRatio={aspectRatio}
      viewport={viewport}
      onAspectRatioChange={setAspectRatio}
      onClose={vi.fn()}
      onViewportChange={(next) => {
        setViewport(next)
        onViewportChange(next)
      }}
    />
  )
}

function advancedControls(
  controlState: BrowserPreviewControlState,
): BrowserPreviewAdvancedControls {
  return {
    busy: null,
    recording: controlState.recording,
    captureScreenshot: vi.fn(),
    pickElement: vi.fn(),
    toggleRecording: vi.fn(),
    controlState,
    setViewport: vi.fn(),
    setAppearance: vi.fn(),
    zoom: vi.fn(),
    toggleDeviceToolbar: vi.fn(),
    hardReload: vi.fn(),
    openDevTools: vi.fn(),
    clearCookies: vi.fn(),
    clearCache: vi.fn(),
    togglePictureInPicture: vi.fn(),
  }
}

describe('BrowserPreviewDeviceToolbar', () => {
  it('offers the stable device catalog and commits exact preset dimensions', () => {
    const onViewportChange = vi.fn()
    render(
      <BrowserPreviewDeviceToolbar
        aspectRatio={null}
        viewport={IPHONE_VIEWPORT}
        onAspectRatioChange={vi.fn()}
        onClose={vi.fn()}
        onViewportChange={onViewportChange}
      />,
    )

    const select = screen.getByRole('combobox', { name: 'Device preset' })
    expect(screen.getAllByRole('option')).toHaveLength(18)
    fireEvent.change(select, { target: { value: 'pixel-7' } })

    expect(onViewportChange).toHaveBeenCalledExactlyOnceWith({
      mode: 'fixed',
      width: 412,
      height: 915,
      presetId: 'pixel-7',
    })
  })

  it('rotates the selected viewport and exposes explicit aspect locking', () => {
    const onViewportChange = vi.fn()
    render(<DeviceToolbarHarness onViewportChange={onViewportChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Rotate viewport' }))
    expect(onViewportChange).toHaveBeenLastCalledWith({
      mode: 'fixed',
      width: 844,
      height: 390,
      presetId: 'iphone-12-pro',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Lock aspect ratio' }))
    expect(screen.getByRole('button', { name: 'Unlock aspect ratio' })).toBeInTheDocument()
  })
})

describe('BrowserPreviewMoreMenu', () => {
  it('shows hard reload, DevTools, device, PiP, appearance, zoom, and site-data controls', () => {
    const advanced = advancedControls({
      ...DEFAULT_BROWSER_PREVIEW_CONTROL_STATE,
      zoomFactor: 1.1,
    })
    render(<BrowserPreviewMoreMenu advanced={advanced} />)

    fireEvent.click(screen.getByRole('button', { name: 'Browser preview options' }))

    expect(screen.getByRole('menuitem', { name: 'Hard reload' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Open DevTools' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Open picture-in-picture' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Open device toolbar' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Reset zoom' })).toHaveTextContent('110%')
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('menuitem', { name: 'Clear cookies' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Clear cache' })).toBeInTheDocument()
  })

  it('invokes destructive and navigation actions deliberately and closes the menu', () => {
    const advanced = advancedControls({
      ...DEFAULT_BROWSER_PREVIEW_CONTROL_STATE,
      appearance: 'dark',
      pictureInPicture: true,
      viewport: { mode: 'fixed', width: 390, height: 844, presetId: 'iphone-12-pro' },
    })
    render(<BrowserPreviewMoreMenu advanced={advanced} />)
    fireEvent.click(screen.getByRole('button', { name: 'Browser preview options' }))

    fireEvent.click(screen.getByRole('menuitem', { name: 'Hard reload' }))

    expect(advanced.hardReload).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('BrowserPreviewCaptureControls', () => {
  it('keeps screenshot, element picking, and bounded recording as separate discoverable actions', () => {
    const onCaptureScreenshot = vi.fn()
    const onPickElement = vi.fn()
    const onToggleRecording = vi.fn()
    render(
      <BrowserPreviewCaptureControls
        busy={null}
        picking={false}
        recording={false}
        onCaptureScreenshot={onCaptureScreenshot}
        onPickElement={onPickElement}
        onToggleRecording={onToggleRecording}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Capture screenshot' }))
    fireEvent.click(screen.getByRole('button', { name: 'Annotate preview for message' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start preview recording' }))

    expect(onCaptureScreenshot).toHaveBeenCalledOnce()
    expect(onPickElement).toHaveBeenCalledOnce()
    expect(onToggleRecording).toHaveBeenCalledOnce()
  })
})
