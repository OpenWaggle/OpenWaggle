import { SessionId } from '@shared/types/brand'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import {
  getViewerCatalog,
  httpImage,
  image,
  listSessionResourcePage,
  listSessionResources,
  locateSessionResourceImage,
  openPath,
  readSessionResource,
  remoteImage,
  renderViewer,
  replaceViewerCatalogResources,
  resetViewerEnvironment,
  retrySessionResource,
} from './session-resource-viewer.test-harness'

describe('SessionResourceViewer', () => {
  beforeEach(resetViewerEnvironment)

  it('does not query resources owned by a stale viewer session', async () => {
    useUIStore.getState().openResourceViewer('stale-session', 'image-1')

    renderViewer('active-session')

    await waitFor(() => expect(useUIStore.getState().resourceViewer).toBeNull())
    expect(listSessionResourcePage).not.toHaveBeenCalled()
    expect(locateSessionResourceImage).not.toHaveBeenCalled()
    expect(listSessionResources).not.toHaveBeenCalled()
    expect(readSessionResource).not.toHaveBeenCalled()
  })

  it('enlarges a session image and navigates the session gallery', async () => {
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    const view = renderViewer('session-1')

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: first.png' }),
    ).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Next image' }))
    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: second.png' }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(
        view.queryClient.getQueryData(['session-resource-content', 'session-1', 'image-1', 1000]),
      ).toBeUndefined()
    })

    const previous = screen.getByRole('button', { name: 'Previous image' })
    previous.focus()
    fireEvent.keyDown(previous, { key: 'ArrowLeft' })
    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: first.png' }),
    ).toBeInTheDocument()
  })

  it('navigates chronologically within the same transcript-path group', async () => {
    listSessionResources.mockResolvedValue([
      { ...image('image-new', 'new.png'), createdAt: 2000, updatedAt: 2000 },
      { ...image('image-old', 'old.png'), createdAt: 1000, updatedAt: 1000 },
    ])
    useUIStore.getState().openResourceViewer('session-1', 'image-old')
    renderViewer('session-1')

    expect(await screen.findByRole('dialog', { name: 'Image viewer: old.png' })).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Next image' }))
    expect(await screen.findByRole('dialog', { name: 'Image viewer: new.png' })).toBeInTheDocument()
  })

  it('keeps gallery chronology stable when image content is materialised later', async () => {
    const oldImage = { ...image('image-old', 'old.png'), createdAt: 1000, updatedAt: 1000 }
    const newImage = { ...image('image-new', 'new.png'), createdAt: 2000, updatedAt: 2000 }
    listSessionResources.mockResolvedValue([oldImage, newImage])
    useUIStore.getState().openResourceViewer('session-1', oldImage.id)
    const view = renderViewer('session-1')

    expect(await screen.findByRole('dialog', { name: 'Image viewer: old.png' })).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()

    replaceViewerCatalogResources(view.queryClient, [{ ...oldImage, updatedAt: 3000 }, newImage])

    await waitFor(() => expect(screen.getByText('1 of 2')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
    expect(await screen.findByRole('dialog', { name: 'Image viewer: new.png' })).toBeInTheDocument()
  })

  it('uses non-message nodes on the active path before a newer off-branch occurrence', async () => {
    const activePathImage = {
      ...image('deduplicated-image', 'deduplicated.png'),
      locator: '/fallback/deduplicated.png',
      occurrences: [
        {
          id: 'active-tool-occurrence',
          nodeId: 'active-tool-node',
          branchId: 'session-1:branch:active',
          actor: 'tool' as const,
          activity: 'read' as const,
          label: null,
          locator: '/active-path/deduplicated.png',
          createdAt: 1,
        },
        {
          id: 'newer-off-branch-occurrence',
          nodeId: 'off-branch-message',
          branchId: 'session-1:branch:other',
          actor: 'extension' as const,
          activity: 'updated' as const,
          label: null,
          locator: '/off-branch/deduplicated.png',
          createdAt: 2,
        },
      ],
    }
    listSessionResources.mockResolvedValue([activePathImage])
    useUIStore.getState().openResourceViewer('session-1', activePathImage.id)

    renderViewer('session-1', new Set(['visible-user-message']), 'session-1:branch:active', [
      'visible-user-message',
      'active-tool-node',
    ])

    expect(await screen.findByLabelText('Image provenance')).toHaveTextContent('Read by a tool')
    fireEvent.click(screen.getByRole('button', { name: 'Open original deduplicated.png' }))
    expect(openPath).toHaveBeenCalledWith('/active-path/deduplicated.png')
  })

  it('skips unavailable managed images during gallery navigation', async () => {
    listSessionResources.mockResolvedValue([
      image('image-1', 'first.png'),
      { ...image('missing-image', 'missing.png'), available: false },
      image('image-2', 'second.png'),
    ])
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: first.png' }),
    ).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Next image' }))
    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: second.png' }),
    ).toBeInTheDocument()
  })

  it('skips HTTP-only images during gallery navigation', async () => {
    listSessionResources.mockResolvedValue([
      image('image-1', 'first.png'),
      httpImage('http-image', 'http.png'),
      image('image-2', 'second.png'),
    ])
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1')

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: first.png' }),
    ).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Next image' }))
    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: second.png' }),
    ).toBeInTheDocument()
  })

  it('requests remote image content only after the user opens the viewer', async () => {
    listSessionResources
      .mockResolvedValueOnce([{ ...remoteImage('remote-image', 'Remote image'), available: false }])
      .mockResolvedValue([image('remote-image', 'Remote image')])
    useUIStore.getState().openResourceViewer('session-1', 'remote-image')
    renderViewer('session-1')

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: Remote image' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(readSessionResource).toHaveBeenCalledWith(SessionId('session-1'), 'remote-image'),
    )
    await waitFor(() => expect(listSessionResources).toHaveBeenCalledTimes(2))
  })

  it('does not refresh-loop the resource projection when a remote image read fails', async () => {
    const remote = { ...remoteImage('remote-image', 'Remote image'), available: false }
    listSessionResources.mockResolvedValue([remote])
    readSessionResource.mockRejectedValue(new Error('Remote image unavailable'))
    useUIStore.getState().openResourceViewer('session-1', 'remote-image')
    const view = renderViewer('session-1')

    expect(await screen.findByRole('button', { name: 'Retry image' })).toBeVisible()
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(listSessionResources).toHaveBeenCalledOnce()
    expect(readSessionResource).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Close image viewer' }))
    const catalog = getViewerCatalog(view.queryClient)
    expect(catalog?.pages[0]?.resources).toMatchObject([{ id: 'remote-image', available: false }])
  })

  it('retries an uncached remote image after its first materialization fails', async () => {
    const remote = { ...remoteImage('remote-image', 'Remote image'), available: false }
    listSessionResources.mockResolvedValue([remote])
    readSessionResource
      .mockRejectedValueOnce(new Error('Remote image unavailable'))
      .mockResolvedValue({
        resourceId: remote.id,
        fileName: 'remote-image.png',
        mimeType: 'image/png',
        url: 'openwaggle-session-resource://content/remote-image/view',
        downloadUrl: 'openwaggle-session-resource://content/remote-image/download',
      })
    useUIStore.getState().openResourceViewer('session-1', remote.id)
    renderViewer('session-1')

    const retry = await screen.findByRole('button', { name: 'Retry image' })
    fireEvent.click(retry)

    expect(await screen.findByRole('img', { name: 'Remote image' })).toBeVisible()
    expect(retrySessionResource).toHaveBeenCalledWith(SessionId('session-1'), remote.id)
    expect(readSessionResource).toHaveBeenCalledTimes(2)
  })

  it('retries a null content read when the resource revision changes', async () => {
    readSessionResource.mockReset().mockResolvedValueOnce(null).mockResolvedValue({
      resourceId: 'image-1',
      fileName: 'image-1.png',
      mimeType: 'image/png',
      url: 'openwaggle-session-resource://content/image-1/view',
      downloadUrl: 'openwaggle-session-resource://content/image-1/download',
    })
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    const view = renderViewer('session-1')
    await screen.findByRole('dialog', { name: 'Image viewer: first.png' })
    await waitFor(() => expect(readSessionResource).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Retry image' })).toBeVisible()

    replaceViewerCatalogResources(view.queryClient, [
      { ...image('image-1', 'first.png'), updatedAt: 2000 },
      image('image-2', 'second.png'),
    ])

    await waitFor(() => expect(readSessionResource).toHaveBeenCalledTimes(2))
  })
})
