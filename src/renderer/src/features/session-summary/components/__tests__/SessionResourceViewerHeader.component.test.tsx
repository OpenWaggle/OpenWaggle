import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const MANAGED_SOURCE = 'data:image/png;base64,aW1hZ2U='

function renderHeader(resource = image('managed-image', 'managed.png')) {
  return render(
    <SessionResourceViewerHeader
      resource={resource}
      index={0}
      count={1}
      zoom="fit"
      source={MANAGED_SOURCE}
      onZoomChange={vi.fn()}
      onClose={vi.fn()}
    />,
  )
}

describe('SessionResourceViewerHeader resource actions', () => {
  beforeEach(() => {
    openExternal.mockReset().mockResolvedValue(undefined)
    openPath.mockReset().mockResolvedValue(undefined)
    revealPath.mockReset().mockResolvedValue(undefined)
  })

  it('keeps the HTTPS source action after managed image content loads', () => {
    renderHeader(remoteImage('remote-image', 'Remote image'))

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
})
