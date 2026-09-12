import { SessionId } from '@shared/types/brand'
import {
  SESSION_RESOURCE_CATALOG_STALE_MESSAGE,
  type SessionResource,
} from '@shared/types/session-resource'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apiMocks,
  LINK,
  OUTPUT,
  resetSessionResourcesPanelEnvironment,
  resource,
  restoreSessionResourcesPanelEnvironment,
  scrollIntoView,
} from '@/features/session-summary/components/__tests__/session-resources-panel.test-harness'
import { createRendererQueryClient } from '@/queries/query-client'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { SessionResourcesPanel } from '../SessionResourcesPanel'

describe('SessionResourcesPanel', () => {
  afterEach(restoreSessionResourcesPanelEnvironment)
  beforeEach(resetSessionResourcesPanelEnvironment)

  it('defaults to Sources and switches to Outputs', async () => {
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)
    expect(await screen.findByText('reference.png')).toBeInTheDocument()
    expect(screen.queryByText('Created PR')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Outputs' }))
    expect(await screen.findByText('Created PR')).toBeInTheDocument()
    expect(screen.queryByText('reference.png')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Sources' }))
    expect(await screen.findByText('reference.png')).toBeInTheDocument()
    expect(screen.getByText('Documentation')).toBeInTheDocument()
    await waitFor(() => {
      expect(apiMocks.readThumbnail).toHaveBeenCalledWith(SessionId('session-one'), 'image')
    })
    expect(apiMocks.read).not.toHaveBeenCalled()
  })

  it('opens on an exact output target instead of a generic resource list', async () => {
    renderWithQueryClient(
      <SessionResourcesPanel
        sessionId="session-one"
        target={{ view: 'outputs', resourceId: 'output' }}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByText('Created PR')).toBeInTheDocument()
    expect(screen.queryByText('reference.png')).toBeNull()
    expect(screen.getByRole('button', { name: 'Outputs' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Created PR/u })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('reveals an exact target even when it falls beyond the first resource page', async () => {
    const outputs = Array.from({ length: 45 }, (_, index) =>
      resource(`output-${String(index)}`, {
        kind: 'file',
        title: `Output ${String(index)}`,
        isSource: false,
        isOutput: true,
        locator: `session-resource://output-${String(index)}`,
      }),
    )
    apiMocks.list.mockResolvedValue(outputs)

    renderWithQueryClient(
      <SessionResourcesPanel
        sessionId="session-one"
        target={{ view: 'outputs', resourceId: 'output-44' }}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByRole('button', { name: /Output 44/u })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.queryByRole('button', { name: /Output 40/u })).toBeNull()
    expect(screen.getAllByRole('button', { name: /Output \d+/u })).toHaveLength(41)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }))
  })

  it('keeps the initial resource DOM bounded and progressively loads the next page', async () => {
    const sources = Array.from({ length: 45 }, (_, index) =>
      resource(`source-${String(index)}`, {
        kind: 'file',
        title: `Source ${String(index)}`,
        isSource: true,
        isOutput: false,
        locator: `session-resource://source-${String(index)}`,
      }),
    )
    apiMocks.list.mockResolvedValue(sources)

    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    expect(await screen.findByText('Source 39')).toBeInTheDocument()
    expect(screen.queryByText('Source 40')).toBeNull()
    expect(screen.getAllByRole('button', { name: /Source \d+/u })).toHaveLength(40)
    fireEvent.click(screen.getByRole('button', { name: 'Show more (5)' }))

    expect(await screen.findByText('Source 44')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Source \d+/u })).toHaveLength(45)
    expect(apiMocks.listPage).toHaveBeenNthCalledWith(1, SessionId('session-one'), {
      view: 'sources',
      cursor: null,
      limit: 40,
    })
    expect(apiMocks.listPage).toHaveBeenNthCalledWith(2, SessionId('session-one'), {
      view: 'sources',
      cursor: '40',
      limit: 40,
    })
  })

  it('restarts from page one when a continuation cursor becomes stale', async () => {
    apiMocks.listPage
      .mockResolvedValueOnce({
        resources: [LINK],
        total: 2,
        nextCursor: 'stale-cursor',
        orderRevision: 'revision-one',
      })
      .mockRejectedValueOnce(new Error(SESSION_RESOURCE_CATALOG_STALE_MESSAGE))
      .mockResolvedValue({
        resources: [LINK],
        total: 1,
        nextCursor: null,
        orderRevision: 'revision-two',
      })

    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)
    expect(await screen.findByText('Documentation')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show more (1)' }))

    await waitFor(() => expect(apiMocks.listPage).toHaveBeenCalledTimes(3))
    expect(apiMocks.listPage).toHaveBeenLastCalledWith(SessionId('session-one'), {
      view: 'sources',
      cursor: null,
      limit: 40,
    })
    expect(screen.getAllByText('Documentation')).toHaveLength(1)
  })

  it('groups resources by category and shows their session provenance', async () => {
    const occurredAt = 1_700_000_000_000
    apiMocks.list.mockResolvedValue([
      resource('source-file', {
        kind: 'file',
        title: 'requirements.md',
        isSource: true,
        isOutput: false,
        locator: 'session-resource://source-file',
        occurrences: [
          {
            id: 'occurrence-source-file',
            nodeId: 'message-one',
            branchId: 'session-one:main',
            actor: 'user',
            activity: 'provided',
            label: null,
            locator: 'session-resource://source-file',
            createdAt: occurredAt,
          },
        ],
      }),
      LINK,
    ])

    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Files' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Links & sites' })).toBeInTheDocument()
    const fileRow = screen.getByRole('button', { name: /requirements\.md/u })
    expect(within(fileRow).getByText('Provided by you')).toBeInTheDocument()
    expect(within(fileRow).getByText('Branch main')).toBeInTheDocument()
    expect(fileRow).toHaveAccessibleName(/Branch main/u)
    const occurredTime = fileRow.querySelector('time')
    expect(occurredTime).toHaveAttribute('datetime', new Date(occurredAt).toISOString())
  })

  it('explains a catalog failure and retries without closing the browser', async () => {
    apiMocks.list.mockRejectedValueOnce(new Error('catalog unavailable')).mockResolvedValue([LINK])

    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t load this session’s sources and outputs.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading resources' }))

    expect(await screen.findByText('Documentation')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(apiMocks.list).toHaveBeenCalledTimes(2)
  })

  it('distinguishes loading from an empty resource view', () => {
    apiMocks.list.mockImplementation(() => new Promise(() => {}))

    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading this session’s sources and outputs…',
    )
    expect(screen.queryByText('No resources in this view.')).toBeNull()
  })

  it('atomically rebinds its target and data when the opened session changes', async () => {
    const firstSession = Promise.withResolvers<SessionResource[]>()
    const secondSessionSource = {
      ...LINK,
      id: 'second-link',
      sessionId: SessionId('session-two'),
      title: 'Second session documentation',
    }
    apiMocks.list.mockImplementation((sessionId: string) =>
      sessionId === 'session-one' ? firstSession.promise : Promise.resolve([secondSessionSource]),
    )
    const client = createRendererQueryClient()
    const view = render(
      <QueryClientProvider client={client}>
        <SessionResourcesPanel
          sessionId="session-one"
          target={{ view: 'outputs', resourceId: 'output' }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    )

    view.rerender(
      <QueryClientProvider client={client}>
        <SessionResourcesPanel
          sessionId="session-two"
          target={{ view: 'sources', resourceId: 'second-link' }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Second session documentation')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sources' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Created PR')).toBeNull()
    firstSession.resolve([OUTPUT])
    await waitFor(() => expect(apiMocks.list).toHaveBeenCalledWith(SessionId('session-two')))
    expect(screen.queryByText('Created PR')).toBeNull()
    expect(apiMocks.list).toHaveBeenCalledWith(SessionId('session-one'))
  })

  it('retries a transient null thumbnail while the preview remains mounted', async () => {
    apiMocks.readThumbnail.mockResolvedValueOnce(null).mockResolvedValueOnce({
      resourceId: 'image',
      fileName: 'image-thumbnail.webp',
      mimeType: 'image/webp',
      dataBase64: 'cmVwYWlyZWQ=',
    })

    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    expect(await screen.findByText('reference.png')).toBeInTheDocument()
    await waitFor(() => expect(apiMocks.readThumbnail).toHaveBeenCalledTimes(2), {
      timeout: 2_500,
    })
    expect(screen.getByRole('img', { name: 'reference.png' })).toHaveAttribute(
      'src',
      'data:image/webp;base64,cmVwYWlyZWQ=',
    )
  })

  it('bounds automatic retries for a permanently unavailable thumbnail', async () => {
    vi.useFakeTimers()
    apiMocks.readThumbnail.mockResolvedValue(null)

    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    await act(() => vi.advanceTimersByTimeAsync(5_000))
    expect(apiMocks.readThumbnail).toHaveBeenCalledTimes(3)
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(apiMocks.readThumbnail).toHaveBeenCalledTimes(3)
  })

  it('opens managed images in the current session viewer and links externally', async () => {
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)
    fireEvent.click(await screen.findByText('reference.png'))
    expect(useUIStore.getState().resourceViewer).toEqual({
      sessionId: 'session-one',
      resourceId: 'image',
    })

    fireEvent.click(screen.getByText('Documentation'))
    await waitFor(() => {
      expect(apiMocks.openExternal).toHaveBeenCalledWith('https://example.com/docs')
    })
  })
})
