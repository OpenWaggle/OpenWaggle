import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { SessionResourcesPanel } from '../SessionResourcesPanel'

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  openExternal: vi.fn(),
  openPath: vi.fn(),
  revealPath: vi.fn(),
  read: vi.fn(),
  readThumbnail: vi.fn(),
  retry: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources: apiMocks.list,
    openExternal: apiMocks.openExternal,
    openPath: apiMocks.openPath,
    revealPath: apiMocks.revealPath,
    readSessionResource: apiMocks.read,
    readSessionResourceThumbnail: apiMocks.readThumbnail,
    retrySessionResource: apiMocks.retry,
  },
}))

function imageResource(
  id: string,
  title: string,
  locator: string,
  available = true,
  managed = locator.startsWith('session-resource://'),
  canonicalKey = `resource:${id}`,
): SessionResource {
  return {
    id,
    sessionId: SessionId('session-one'),
    canonicalKey,
    kind: 'image',
    title,
    mimeType: 'image/png',
    locator,
    managed,
    available,
    isSource: true,
    isOutput: false,
    occurrences: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('SessionResourcesPanel source actions', () => {
  beforeEach(() => {
    useUIStore.setState({ resourceViewer: null })
    apiMocks.list.mockReset()
    apiMocks.openExternal.mockReset().mockResolvedValue(undefined)
    apiMocks.openPath.mockReset().mockResolvedValue(undefined)
    apiMocks.revealPath.mockReset().mockResolvedValue(undefined)
    apiMocks.read.mockReset().mockResolvedValue(null)
    apiMocks.readThumbnail.mockReset().mockResolvedValue(null)
    apiMocks.retry.mockReset().mockResolvedValue(undefined)
  })

  it('opens non-materializable HTTP images externally', async () => {
    apiMocks.list.mockResolvedValue([
      imageResource('http-image', 'insecure-image.png', 'http://example.com/insecure-image.png'),
    ])
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    fireEvent.click(await screen.findByText('insecure-image.png'))

    await waitFor(() =>
      expect(apiMocks.openExternal).toHaveBeenCalledWith('http://example.com/insecure-image.png'),
    )
    expect(useUIStore.getState().resourceViewer).toBeNull()
  })

  it('opens and retries the original path for an unavailable attachment', async () => {
    apiMocks.list.mockResolvedValue([
      imageResource('missing-image', 'missing.png', '/input/missing.png', false),
    ])
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    fireEvent.click(await screen.findByText('missing.png'))

    await waitFor(() => expect(apiMocks.openPath).toHaveBeenCalledWith('/input/missing.png'))
    expect(useUIStore.getState().resourceViewer).toBeNull()
    expect(screen.getByText('Unavailable · Open original')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry missing.png' }))
    await waitFor(() =>
      expect(apiMocks.retry).toHaveBeenCalledWith(SessionId('session-one'), 'missing-image'),
    )
    await waitFor(() => expect(apiMocks.list).toHaveBeenCalledTimes(2))
  })

  it('offers retry without an inert managed-content activation when cached bytes are unavailable', async () => {
    apiMocks.list.mockResolvedValue([
      imageResource(
        'missing-managed-image',
        'missing-managed.png',
        'session-resource://missing-managed-image',
        false,
      ),
    ])
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    const resourceRow = (await screen.findByText('missing-managed.png')).closest('button')
    expect(resourceRow).not.toBeNull()
    expect(resourceRow).toBeDisabled()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry missing-managed.png' }))

    await waitFor(() =>
      expect(apiMocks.retry).toHaveBeenCalledWith(
        SessionId('session-one'),
        'missing-managed-image',
      ),
    )
    expect(apiMocks.read).not.toHaveBeenCalled()
  })

  it('does not offer Retry for an unrecoverable generated image', async () => {
    apiMocks.list.mockResolvedValue([
      imageResource(
        'invalid-generated-image',
        'invalid-generated.png',
        '',
        false,
        false,
        'unavailable-image:session-one:node-one:0',
      ),
    ])
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    const resourceRow = (await screen.findByText('invalid-generated.png')).closest('button')
    expect(resourceRow).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Retry invalid-generated.png' })).toBeNull()
  })

  it('keeps open and reveal actions for an original path beside a managed copy', async () => {
    apiMocks.list.mockResolvedValue([
      imageResource('managed-local', 'managed-local.png', '/input/managed-local.png', true, true),
    ])
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open original managed-local.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal original managed-local.png' }))

    expect(apiMocks.openPath).toHaveBeenCalledWith('/input/managed-local.png')
    expect(apiMocks.revealPath).toHaveBeenCalledWith('/input/managed-local.png')
    expect(screen.getByText('Managed copy · Original available')).toBeInTheDocument()
  })

  it('announces retry failure and suppresses concurrent resource retries', async () => {
    apiMocks.list.mockResolvedValue([
      imageResource('missing-image', 'missing.png', '/input/missing.png', false),
    ])
    const retryResult = Promise.withResolvers<never>()
    apiMocks.retry.mockReturnValue(retryResult.promise)
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)
    const retry = await screen.findByRole('button', { name: 'Retry missing.png' })

    fireEvent.click(retry)
    fireEvent.click(retry)
    await waitFor(() => expect(apiMocks.retry).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Retry missing.png' })).toBeDisabled()
    retryResult.reject(new Error('Original is still missing'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Original is still missing')
  })
})
