import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { SessionMessageImages, SessionMessageResourcesProvider } from '../SessionMessageImages'

const listSessionResources = vi.hoisted(() => vi.fn())
const readSessionResource = vi.hoisted(() => vi.fn())
const readSessionResourceThumbnail = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: { listSessionResources, readSessionResource, readSessionResourceThumbnail },
}))

function image(id: string, nodeId: string): SessionResource {
  return {
    id,
    sessionId: SessionId('session-1'),
    canonicalKey: `sha256:${id}`,
    kind: 'image',
    title: `${id}.png`,
    mimeType: 'image/png',
    locator: `session-resource://${id}`,
    managed: true,
    available: true,
    isSource: true,
    isOutput: false,
    occurrences: [
      {
        id: `occurrence-${id}`,
        nodeId,
        branchId: null,
        actor: 'user',
        activity: 'provided',
        label: null,
        locator: `session-resource://${id}`,
        createdAt: 1000,
      },
    ],
    createdAt: 1000,
    updatedAt: 1000,
  }
}

function remoteImage(id: string, nodeId: string): SessionResource {
  return {
    ...image(id, nodeId),
    canonicalKey: `url:https://images.example/${id}.png`,
    mimeType: null,
    locator: `https://images.example/${id}.png`,
    managed: false,
  }
}

describe('SessionMessageImages', () => {
  beforeEach(() => {
    useUIStore.setState({ resourceViewer: null })
    listSessionResources
      .mockReset()
      .mockResolvedValue([image('matching', 'message-1'), image('other-message', 'message-2')])
    readSessionResource.mockReset().mockResolvedValue({
      resourceId: 'matching',
      fileName: 'matching.png',
      mimeType: 'image/png',
      url: 'openwaggle-session-resource://content/matching/view',
      downloadUrl: 'openwaggle-session-resource://content/matching/download',
    })
    readSessionResourceThumbnail.mockReset().mockResolvedValue({
      resourceId: 'matching',
      fileName: 'matching-thumbnail.webp',
      mimeType: 'image/webp',
      dataBase64: 'dGh1bWJuYWls',
    })
  })

  it('renders only images attached to this message and opens the session viewer', async () => {
    renderWithQueryClient(
      <SessionMessageResourcesProvider sessionId={SessionId('session-1')} nodeIds={['message-1']}>
        <SessionMessageImages messageId="message-1" />
      </SessionMessageResourcesProvider>,
    )

    const imageButton = await screen.findByRole('button', { name: 'Open image matching.png' })
    expect(screen.queryByRole('button', { name: 'Open image other-message.png' })).toBeNull()
    expect(readSessionResourceThumbnail).toHaveBeenCalledWith(SessionId('session-1'), 'matching')
    expect(readSessionResource).not.toHaveBeenCalled()

    fireEvent.click(imageButton)
    expect(useUIStore.getState().resourceViewer).toEqual({
      sessionId: 'session-1',
      resourceId: 'matching',
    })
  })

  it('does not fetch a remote image merely because its preview is visible', async () => {
    listSessionResources.mockResolvedValue([remoteImage('remote', 'message-1')])
    renderWithQueryClient(
      <SessionMessageResourcesProvider sessionId={SessionId('session-1')} nodeIds={['message-1']}>
        <SessionMessageImages messageId="message-1" />
      </SessionMessageResourcesProvider>,
    )

    const imageButton = await screen.findByRole('button', { name: 'Open image remote.png' })
    expect(readSessionResource).not.toHaveBeenCalled()
    expect(readSessionResourceThumbnail).not.toHaveBeenCalled()

    fireEvent.click(imageButton)
    expect(useUIStore.getState().resourceViewer).toEqual({
      sessionId: 'session-1',
      resourceId: 'remote',
    })
    expect(readSessionResource).not.toHaveBeenCalled()
  })

  it('does not render an action for unavailable managed images', async () => {
    listSessionResources.mockResolvedValue([{ ...image('missing', 'message-1'), available: false }])
    renderWithQueryClient(
      <SessionMessageResourcesProvider sessionId={SessionId('session-1')} nodeIds={['message-1']}>
        <SessionMessageImages messageId="message-1" />
      </SessionMessageResourcesProvider>,
    )

    await waitFor(() => expect(listSessionResources).toHaveBeenCalled())
    expect(screen.queryByRole('group', { name: 'Message images' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open image missing.png' })).toBeNull()
  })

  it('does not expose an SVG demoted to a file as a captured message image', async () => {
    listSessionResources.mockResolvedValue([
      {
        ...image('unsafe-svg', 'message-1'),
        kind: 'file',
        title: 'unsafe.svg',
        mimeType: 'image/svg+xml',
      },
    ])
    renderWithQueryClient(
      <SessionMessageResourcesProvider sessionId={SessionId('session-1')} nodeIds={['message-1']}>
        <SessionMessageImages messageId="message-1" />
      </SessionMessageResourcesProvider>,
    )

    await waitFor(() => expect(listSessionResources).toHaveBeenCalledOnce())
    expect(screen.queryByRole('group', { name: 'Message images' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open image unsafe.svg' })).toBeNull()
  })

  it('indexes one session catalog for every visible message bubble', async () => {
    renderWithQueryClient(
      <SessionMessageResourcesProvider
        sessionId={SessionId('session-1')}
        nodeIds={['message-1', 'message-2', 'message-without-images']}
      >
        <SessionMessageImages messageId="message-1" />
        <SessionMessageImages messageId="message-2" />
        <SessionMessageImages messageId="message-without-images" />
      </SessionMessageResourcesProvider>,
    )

    expect(await screen.findByRole('button', { name: 'Open image matching.png' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Open image other-message.png' })).toBeVisible()
    expect(listSessionResources).toHaveBeenCalledOnce()
  })

  it('ignores catalog rows that do not belong to the provider session', async () => {
    listSessionResources.mockResolvedValue([
      { ...image('foreign', 'message-1'), sessionId: SessionId('session-2') },
    ])
    renderWithQueryClient(
      <SessionMessageResourcesProvider sessionId={SessionId('session-1')} nodeIds={['message-1']}>
        <SessionMessageImages messageId="message-1" />
      </SessionMessageResourcesProvider>,
    )

    await waitFor(() => expect(listSessionResources).toHaveBeenCalledOnce())
    expect(screen.queryByRole('group', { name: 'Message images' })).toBeNull()
  })
})
