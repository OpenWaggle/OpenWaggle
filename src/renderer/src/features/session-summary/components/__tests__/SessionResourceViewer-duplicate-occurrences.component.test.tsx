import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import {
  image,
  listSessionResources,
  renderViewer,
  resetViewerEnvironment,
} from './session-resource-viewer.test-harness'

describe('SessionResourceViewer repeated occurrences', () => {
  beforeEach(resetViewerEnvironment)

  it('navigates repeated occurrences of the same image by gallery position', async () => {
    listSessionResources.mockResolvedValue([
      image('same', 'same.png'),
      image('middle', 'middle.png'),
    ])
    useUIStore.getState().openResourceViewer('session-1', 'same', ['same', 'middle', 'same'], 2)
    renderViewer('session-1')

    expect(await screen.findByRole('dialog', { name: 'Image viewer: same.png' })).toBeVisible()
    expect(screen.getByText('3 of 3')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
    expect(screen.getByText('1 of 3')).toBeVisible()
    expect(useUIStore.getState().resourceViewer?.galleryIndex).toBe(0)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('3 of 3')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Previous image' }))
    expect(await screen.findByRole('dialog', { name: 'Image viewer: middle.png' })).toBeVisible()
    expect(screen.getByText('2 of 3')).toBeVisible()
  })

  it('shows the attachment name for this occurrence when the managed image was reused', async () => {
    listSessionResources.mockResolvedValue([image('shared', 'original.png')])
    useUIStore
      .getState()
      .openResourceViewer('session-1', 'shared', ['shared'], undefined, ['renamed.png'])
    renderViewer('session-1')

    expect(await screen.findByRole('dialog', { name: 'Image viewer: renamed.png' })).toBeVisible()
    expect(await screen.findByRole('img', { name: 'renamed.png' })).toBeVisible()
  })
})
