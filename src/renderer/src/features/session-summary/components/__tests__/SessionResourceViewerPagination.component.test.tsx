import { SessionId } from '@shared/types/brand'
import type { SessionResourceCatalogPageRequest } from '@shared/types/session-resource'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import {
  image,
  listSessionResourcePage,
  listSessionResources,
  locateSessionResourceImage,
  openPath,
  renderViewer,
  resetViewerEnvironment,
  revealPath,
} from './session-resource-viewer.test-harness'

describe('SessionResourceViewer', () => {
  beforeEach(resetViewerEnvironment)

  it('loads the next image page before navigating beyond the first page', async () => {
    const images = Array.from({ length: 45 }, (_, index) =>
      image(`image-${String(index)}`, `image-${String(index)}.png`),
    )
    listSessionResourcePage.mockImplementation(
      (_sessionId: SessionId, input: SessionResourceCatalogPageRequest) => {
        const offset = input.cursor ? Number(input.cursor) : 0
        const resources = images.slice(offset, offset + input.limit)
        const nextOffset = offset + resources.length
        return Promise.resolve({
          resources,
          total: images.length,
          nextCursor: nextOffset < images.length ? String(nextOffset) : null,
          orderRevision: 'revision-one',
        })
      },
    )
    useUIStore.getState().openResourceViewer('session-1', 'image-39')
    renderViewer('session-1')

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: image-39.png' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(listSessionResourcePage).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: image-40.png' }),
    ).toBeInTheDocument()
    expect(screen.getByText('41 of 45')).toBeInTheDocument()
  })

  it('deep-opens beyond page one with its true ordinal and both adjacent images', async () => {
    const firstPage = Array.from({ length: 40 }, (_, index) =>
      image(`image-${String(index)}`, `image-${String(index)}.png`),
    )
    const target = image('image-10000', 'image-10000.png')
    listSessionResourcePage
      .mockResolvedValueOnce({
        resources: firstPage,
        total: 10_002,
        nextCursor: '40',
        orderRevision: 'revision-one',
      })
      .mockResolvedValue({
        resources: [],
        total: 10_002,
        nextCursor: null,
        orderRevision: 'revision-one',
      })
    const previous = image('image-9999', 'image-9999.png')
    const next = image('image-10001', 'image-10001.png')
    locateSessionResourceImage.mockImplementation((_sessionId: SessionId, resourceId: string) => {
      if (resourceId === previous.id) {
        return Promise.resolve({
          resource: previous,
          previous: image('image-9998', 'image-9998.png'),
          next: target,
          index: 9_999,
          total: 10_002,
          orderRevision: 'revision-one',
        })
      }
      if (resourceId === next.id) {
        return Promise.resolve({
          resource: next,
          previous: target,
          next: null,
          index: 10_001,
          total: 10_002,
          orderRevision: 'revision-one',
        })
      }
      return Promise.resolve({
        resource: target,
        previous,
        next,
        index: 10_000,
        total: 10_002,
        orderRevision: 'revision-one',
      })
    })
    useUIStore.getState().openResourceViewer('session-1', target.id)
    renderViewer('session-1')

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: image-10000.png' }),
    ).toBeInTheDocument()
    expect(screen.getByText('10001 of 10002')).toBeInTheDocument()
    expect(locateSessionResourceImage).toHaveBeenCalledWith(SessionId('session-1'), target.id)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)))
    expect(listSessionResourcePage).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Previous image' }))
    expect(useUIStore.getState().resourceViewer?.resourceId).toBe(previous.id)
    await screen.findByRole('dialog', { name: 'Image viewer: image-9999.png' })
    act(() => useUIStore.getState().openResourceViewer('session-1', target.id))
    await screen.findByRole('dialog', { name: 'Image viewer: image-10000.png' })
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
    expect(useUIStore.getState().resourceViewer?.resourceId).toBe(next.id)
  })

  it('refreshes the first gallery page when the active branch changes', async () => {
    listSessionResourcePage
      .mockResolvedValueOnce({
        resources: [image('image-1', 'active-branch-a.png')],
        total: 1,
        nextCursor: null,
        orderRevision: 'branch-a:1',
      })
      .mockResolvedValue({
        resources: [image('image-1', 'active-branch-b.png')],
        total: 1,
        nextCursor: null,
        orderRevision: 'branch-b:1',
      })
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    const view = renderViewer('session-1', new Set(), 'branch-a')
    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: active-branch-a.png' }),
    ).toBeInTheDocument()

    view.rerenderBranch('branch-b')

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: active-branch-b.png' }),
    ).toBeInTheDocument()
    expect(listSessionResourcePage).toHaveBeenCalledTimes(2)
  })

  it('uses the displayed inactive branch path for a deep-linked image and its neighbors', async () => {
    const target = image('hidden-image', 'hidden.png', 'hidden-leaf')
    const previous = image('root-image', 'root.png', 'root-node')
    const next = image('hidden-next-image', 'hidden-next.png', 'hidden-next')
    const selection = {
      branchId: 'session-1:branch:hidden',
      pathNodeIds: ['root-node', 'hidden-leaf'],
    }
    listSessionResourcePage.mockResolvedValue({
      resources: [previous, target, next],
      total: 3,
      nextCursor: null,
      orderRevision: 'hidden-path',
    })
    locateSessionResourceImage.mockResolvedValue({
      resource: target,
      previous,
      next,
      index: 1,
      total: 3,
      orderRevision: 'hidden-path',
    })
    useUIStore.getState().openResourceViewer('session-1', target.id)

    renderViewer(
      'session-1',
      new Set(selection.pathNodeIds),
      selection.branchId,
      selection.pathNodeIds,
    )

    expect(await screen.findByRole('dialog', { name: 'Image viewer: hidden.png' })).toBeVisible()
    expect(screen.getByText('2 of 3')).toBeVisible()
    expect(listSessionResourcePage).toHaveBeenCalledWith(SessionId('session-1'), {
      view: 'images',
      cursor: null,
      limit: 40,
      selection,
    })
    expect(locateSessionResourceImage).toHaveBeenCalledWith(
      SessionId('session-1'),
      target.id,
      selection,
    )
  })

  it('refreshes image ordering when a deep link changes within the same branch', async () => {
    listSessionResourcePage.mockImplementation((_sessionId, input) => {
      const leaf = input.selection?.pathNodeIds.at(-1) ?? 'none'
      return Promise.resolve({
        resources: [image('image-1', `${leaf}.png`, leaf)],
        total: 1,
        nextCursor: null,
        orderRevision: leaf,
      })
    })
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    const view = renderViewer('session-1', new Set(['root-node', 'first-leaf']), 'session-1:main', [
      'root-node',
      'first-leaf',
    ])
    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: first-leaf.png' }),
    ).toBeVisible()

    view.rerenderPath(['root-node', 'second-leaf'])

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: second-leaf.png' }),
    ).toBeVisible()
    expect(listSessionResourcePage).toHaveBeenCalledTimes(2)
  })

  it('places images from the active transcript path before images from other branches', async () => {
    listSessionResources.mockResolvedValue([
      image('image-2', 'other-branch.png', 'hidden-message'),
      image('image-1', 'active-branch.png', 'active-message'),
    ])
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    renderViewer('session-1', new Set(['active-message']))

    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: active-branch.png' }),
    ).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
  })

  it('shows provenance and preserves local original actions beside the managed image', async () => {
    const local = {
      ...image('image-local', 'local.png', 'node-local'),
      locator: '/input/local.png',
      occurrences: [
        {
          id: 'local-occurrence',
          nodeId: 'node-local',
          branchId: 'session-1:main',
          actor: 'user' as const,
          activity: 'provided' as const,
          label: null,
          locator: '/input/local.png',
          createdAt: 1000,
        },
      ],
    }
    listSessionResources.mockResolvedValue([local])
    useUIStore.getState().openResourceViewer('session-1', local.id)
    renderViewer('session-1')

    expect(await screen.findByText(/Source · Provided by you · Branch main/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Open original local.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal original local.png' }))
    expect(openPath).toHaveBeenCalledWith('/input/local.png')
    expect(revealPath).toHaveBeenCalledWith('/input/local.png')
  })

  it('closes immediately when the user opens a different session', async () => {
    useUIStore.getState().openResourceViewer('session-1', 'image-1')
    const view = renderViewer('session-1')
    expect(
      await screen.findByRole('dialog', { name: 'Image viewer: first.png' }),
    ).toBeInTheDocument()

    view.rerenderSession('session-2')

    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(useUIStore.getState().resourceViewer).toBeNull())
  })
})
