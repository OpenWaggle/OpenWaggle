import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceBrowserSurfaceTab } from '../WorkspaceBrowserSurfaceTab'

const callbacks = {
  onClose: vi.fn(),
  onOpenContextMenu: vi.fn(),
  onSelect: vi.fn(),
  onToggleMuted: vi.fn(),
}

function renderTab(
  overrides: Partial<ComponentProps<typeof WorkspaceBrowserSurfaceTab>['tab']> = {},
) {
  return render(
    <WorkspaceBrowserSurfaceTab
      active
      tab={{
        id: 'preview-one',
        kind: 'preview',
        title: 'Example',
        url: 'https://example.com',
        audioMuted: false,
        audible: false,
        favicon: null,
        ...overrides,
      }}
      {...callbacks}
    />,
  )
}

describe('WorkspaceBrowserSurfaceTab', () => {
  it('keeps a quiet materialized tab free of a misleading audio indicator', () => {
    renderTab()

    expect(screen.queryByRole('button', { name: 'Mute Example' })).not.toBeInTheDocument()
  })

  it('exposes the audible tab mute control and preserves mute intent', () => {
    renderTab({ audible: true, audioMuted: true })

    fireEvent.click(screen.getByRole('button', { name: 'Unmute Example' }))

    expect(callbacks.onToggleMuted).toHaveBeenCalledOnce()
  })

  it('renders a captured favicon and falls back safely when decoding fails', () => {
    const result = renderTab({
      favicon: {
        dataUrl: 'data:image/png;base64,aWNvbg==',
        pageUrl: 'https://example.com/',
        capturedAt: 123,
      },
    })
    const image = result.container.querySelector('img')

    expect(image).not.toBeNull()
    if (image === null) throw new Error('Expected favicon image')
    fireEvent.error(image)
    expect(result.container.querySelector('img')).toBeNull()
  })
})
