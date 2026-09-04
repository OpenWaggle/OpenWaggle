import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRendererQueryClient } from '@/queries/query-client'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { SessionResourcesPanel } from '../SessionResourcesPanel'

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  openExternal: vi.fn(),
  openPath: vi.fn(),
  read: vi.fn(),
  readThumbnail: vi.fn(),
  retry: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources: apiMocks.list,
    openExternal: apiMocks.openExternal,
    openPath: apiMocks.openPath,
    readSessionResource: apiMocks.read,
    readSessionResourceThumbnail: apiMocks.readThumbnail,
    retrySessionResource: apiMocks.retry,
  },
}))

function resource(
  id: string,
  input: Pick<SessionResource, 'kind' | 'title' | 'isSource' | 'isOutput' | 'locator'> &
    Partial<Pick<SessionResource, 'available' | 'occurrences'>>,
): SessionResource {
  return {
    id,
    sessionId: SessionId('session-one'),
    canonicalKey: `resource:${id}`,
    mimeType: input.kind === 'image' ? 'image/png' : null,
    available: input.available ?? true,
    occurrences: [],
    createdAt: 1,
    updatedAt: 1,
    ...input,
  }
}

const IMAGE = resource('image', {
  kind: 'image',
  title: 'reference.png',
  isSource: true,
  isOutput: false,
  locator: 'session-resource://image',
})
const LINK = resource('link', {
  kind: 'link',
  title: 'Documentation',
  isSource: true,
  isOutput: false,
  locator: 'https://example.com/docs',
})
const OUTPUT = resource('output', {
  kind: 'change-request',
  title: 'Created PR',
  isSource: false,
  isOutput: true,
  locator: 'https://github.com/openwaggle/openwaggle/pull/1',
})

describe('SessionResourcesPanel', () => {
  beforeEach(() => {
    useUIStore.setState({ resourceViewer: null })
    apiMocks.list.mockReset().mockResolvedValue([IMAGE, LINK, OUTPUT])
    apiMocks.openExternal.mockReset().mockResolvedValue(undefined)
    apiMocks.openPath.mockReset().mockResolvedValue(undefined)
    apiMocks.read.mockReset().mockResolvedValue(null)
    apiMocks.retry.mockReset().mockResolvedValue(undefined)
    apiMocks.readThumbnail.mockReset().mockResolvedValue({
      resourceId: 'image',
      fileName: 'image-thumbnail.webp',
      mimeType: 'image/webp',
      dataBase64: 'dGh1bWJuYWls',
    })
  })

  it('defaults to Sources and switches to Outputs', async () => {
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)
    expect(await screen.findByText('reference.png')).toBeInTheDocument()
    expect(screen.queryByText('Created PR')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Outputs' }))
    expect(screen.getByText('Created PR')).toBeInTheDocument()
    expect(screen.queryByText('reference.png')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Sources' }))
    expect(screen.getByText('reference.png')).toBeInTheDocument()
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
            branchId: 'feature/resources',
            actor: 'user',
            activity: 'provided',
            label: null,
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
    expect(within(fileRow).getByText('Branch feature/resources')).toBeInTheDocument()
    expect(fileRow).toHaveAccessibleName(/Branch feature\/resources/u)
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
    apiMocks.readThumbnail.mockResolvedValue(null)

    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    expect(await screen.findByText('reference.png')).toBeInTheDocument()
    await waitFor(() => expect(apiMocks.readThumbnail).toHaveBeenCalledTimes(3), {
      timeout: 3_500,
    })
    await new Promise((resolve) => setTimeout(resolve, 1_200))
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
