import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { SessionResourceViewerCanvas } from '../SessionResourceViewerCanvas'
import { SessionResourceViewerHeader } from '../SessionResourceViewerHeader'
import { image, remoteImage } from './session-resource-viewer.test-harness'

const openExternal = vi.hoisted(() => vi.fn())
const openPath = vi.hoisted(() => vi.fn())
const revealPath = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    openExternal,
    openPath,
    revealPath,
  },
}))

const MANAGED_SOURCE = 'openwaggle-session-resource://content/managed-image/view'
const MANAGED_DOWNLOAD = 'openwaggle-session-resource://content/managed-image/download'

function renderHeader(
  resource = image('managed-image', 'managed.png'),
  activePathNodeIds: ReadonlySet<string> = new Set(),
) {
  const props = {
    resource,
    index: 0,
    count: 1,
    zoom: 'fit' as const,
    source: MANAGED_SOURCE,
    downloadUrl: MANAGED_DOWNLOAD,
    branchNames: new Map(),
    activePathNodeIds,
    onZoomChange: vi.fn(),
    onClose: vi.fn(),
  }
  return render(<SessionResourceViewerHeader {...props} />)
}

describe('SessionResourceViewerHeader resource actions', () => {
  beforeEach(() => {
    useUIStore.setState({ toastMessage: null, toastData: null })
    openExternal.mockReset().mockResolvedValue(undefined)
    openPath.mockReset().mockResolvedValue(undefined)
    revealPath.mockReset().mockResolvedValue(undefined)
  })

  it('keeps the HTTPS source action after managed image content loads', () => {
    renderHeader(remoteImage('remote-image', 'Remote image'))

    expect(screen.getByLabelText('Image provenance')).toHaveTextContent('1 of 1 · Source')
    expect(screen.getByRole('button', { name: 'Download image' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open image source' }))

    expect(openExternal).toHaveBeenCalledWith('https://images.example/remote-image.png')
  })

  it('keeps local original actions beside managed image content', () => {
    renderHeader({
      ...image('local-image', 'local.png'),
      locator: '/input/local.png',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open original local.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal original local.png' }))

    expect(openPath).toHaveBeenCalledWith('/input/local.png')
    expect(revealPath).toHaveBeenCalledWith('/input/local.png')
    expect(screen.queryByRole('button', { name: 'Open image source' })).toBeNull()
  })

  it('does not offer an external source action for a managed locator', () => {
    renderHeader()

    expect(screen.getByRole('button', { name: 'Download image' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open image source' })).toBeNull()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('uses the active transcript occurrence for provenance and original actions', () => {
    renderHeader(
      {
        ...image('deduplicated-image', 'deduplicated.png'),
        locator: '/fallback/deduplicated.png',
        occurrences: [
          {
            id: 'active-occurrence',
            nodeId: 'active-node',
            branchId: null,
            actor: 'user',
            activity: 'provided',
            label: null,
            locator: '/active/deduplicated.png',
            createdAt: 1,
          },
          {
            id: 'hidden-occurrence',
            nodeId: 'hidden-node',
            branchId: null,
            actor: 'extension',
            activity: 'provided',
            label: 'a hidden extension',
            locator: '/hidden/deduplicated.png',
            createdAt: 2,
          },
        ],
      },
      new Set(['active-node']),
    )

    expect(screen.getByLabelText('Image provenance')).toHaveTextContent('Provided by you')
    fireEvent.click(screen.getByRole('button', { name: 'Open original deduplicated.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal original deduplicated.png' }))

    expect(openPath).toHaveBeenCalledWith('/active/deduplicated.png')
    expect(revealPath).toHaveBeenCalledWith('/active/deduplicated.png')
  })

  it('falls back to the latest occurrence locator before the resource locator', () => {
    renderHeader({
      ...image('deduplicated-image', 'deduplicated.png'),
      locator: '/fallback/deduplicated.png',
      occurrences: [
        {
          id: 'old-occurrence',
          nodeId: 'old-node',
          branchId: null,
          actor: 'user',
          activity: 'provided',
          label: null,
          locator: '/old/deduplicated.png',
          createdAt: 1,
        },
        {
          id: 'latest-occurrence',
          nodeId: 'latest-node',
          branchId: null,
          actor: 'agent',
          activity: 'created',
          label: null,
          locator: '/latest/deduplicated.png',
          createdAt: 2,
        },
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open original deduplicated.png' }))

    expect(screen.getByLabelText('Image provenance')).toHaveTextContent('Created by the agent')
    expect(openPath).toHaveBeenCalledWith('/latest/deduplicated.png')
  })

  it('reports failures from original and external source actions', async () => {
    openPath.mockRejectedValueOnce(new Error('The original image is unavailable.'))
    const view = renderHeader({
      ...image('local-image', 'local.png'),
      locator: '/input/local.png',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open original local.png' }))
    await waitFor(() =>
      expect(useUIStore.getState().toastData).toEqual({
        message: 'The original image is unavailable.',
        variant: 'error',
      }),
    )

    view.unmount()
    useUIStore.setState({ toastMessage: null, toastData: null })
    openExternal.mockRejectedValueOnce(new Error('The image host is unavailable.'))
    renderHeader(remoteImage('remote-image', 'Remote image'))
    fireEvent.click(screen.getByRole('button', { name: 'Open image source' }))
    await waitFor(() =>
      expect(useUIStore.getState().toastData).toEqual({
        message: 'The image host is unavailable.',
        variant: 'error',
      }),
    )
  })

  it('reports a failure from the canvas source fallback', async () => {
    openExternal.mockRejectedValueOnce(new Error('The source could not be opened.'))
    render(
      <SessionResourceViewerCanvas
        resource={remoteImage('remote-image', 'Remote image')}
        source={null}
        zoom="fit"
        canvasRef={createRef<HTMLElement>()}
        onZoomChange={vi.fn()}
        onImageError={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open source' }))

    await waitFor(() =>
      expect(useUIStore.getState().toastData).toEqual({
        message: 'The source could not be opened.',
        variant: 'error',
      }),
    )
  })
})
