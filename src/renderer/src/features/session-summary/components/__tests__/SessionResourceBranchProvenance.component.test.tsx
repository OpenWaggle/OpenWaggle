import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { act, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/features/sessions/state'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { SessionResourcesPanel } from '../SessionResourcesPanel'
import { SessionResourceViewer } from '../SessionResourceViewer'

const listSessionResources = vi.hoisted(() => vi.fn())
const readSessionResource = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources,
    readSessionResource,
    readSessionResourceThumbnail: vi.fn().mockResolvedValue(null),
    retrySessionResource: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
    openPath: vi.fn().mockResolvedValue(undefined),
    revealPath: vi.fn().mockResolvedValue(undefined),
  },
}))

const BRANCH_ID = 'session-one:branch:source-node-7'

function setActiveTree(sessionId: string, branchName: string) {
  const brandedSessionId = SessionId(sessionId)
  useSessionStore.setState({
    activeWorkspace: null,
    activeSessionTree: {
      session: {
        id: brandedSessionId,
        title: sessionId,
        projectPath: '/project',
        createdAt: 1,
        updatedAt: 2,
      },
      nodes: [],
      branches: [
        {
          id: SessionBranchId(BRANCH_ID),
          sessionId: brandedSessionId,
          sourceNodeId: null,
          headNodeId: null,
          name: branchName,
          isMain: false,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      branchStates: [],
      uiState: null,
    },
  })
}

function resource(kind: 'file' | 'image'): SessionResource {
  return {
    id: `resource-${kind}`,
    sessionId: SessionId('session-one'),
    canonicalKey: `resource:${kind}`,
    kind,
    title: kind === 'image' ? 'branch-image.png' : 'branch-notes.md',
    mimeType: kind === 'image' ? 'image/png' : 'text/markdown',
    locator: `session-resource://resource-${kind}`,
    managed: true,
    available: true,
    isSource: true,
    isOutput: false,
    occurrences: [
      {
        id: `occurrence-${kind}`,
        nodeId: 'message-one',
        branchId: BRANCH_ID,
        actor: 'user',
        activity: 'provided',
        label: null,
        createdAt: 1,
      },
    ],
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('session resource friendly branch provenance', () => {
  beforeEach(() => {
    useUIStore.setState({ resourceViewer: null })
    useSessionStore.setState({ activeSessionTree: null, activeWorkspace: null })
    listSessionResources.mockReset()
    readSessionResource.mockReset().mockResolvedValue({
      resourceId: 'resource-image',
      fileName: 'branch-image.png',
      mimeType: 'image/png',
      dataBase64: 'aW1hZ2U=',
    })
  })

  it('shows the renamed branch in the resource panel only for its owning session', async () => {
    listSessionResources.mockResolvedValue([resource('file')])
    setActiveTree('session-two', 'Wrong session branch')
    renderWithQueryClient(<SessionResourcesPanel sessionId="session-one" onClose={vi.fn()} />)

    const row = await screen.findByRole('button', { name: /branch-notes\.md/u })
    expect(row).not.toHaveTextContent('Wrong session branch')
    expect(row).not.toHaveTextContent('source-node-7')

    act(() => setActiveTree('session-one', 'Renamed resource investigation'))

    expect(
      await within(row).findByText('Branch Renamed resource investigation'),
    ).toBeInTheDocument()
  })

  it('updates viewer provenance without leaking a mismatched session branch', async () => {
    listSessionResources.mockResolvedValue([resource('image')])
    setActiveTree('session-one', 'Renamed visual review')
    useUIStore.getState().openResourceViewer('session-one', 'resource-image')
    renderWithQueryClient(<SessionResourceViewer activeSessionId="session-one" />)

    const provenance = await screen.findByLabelText('Image provenance')
    expect(provenance).toHaveTextContent('Branch Renamed visual review')

    act(() => setActiveTree('session-two', 'Wrong session branch'))

    await waitFor(() => expect(provenance).not.toHaveTextContent('Renamed visual review'))
    expect(provenance).not.toHaveTextContent('Wrong session branch')
    expect(provenance).not.toHaveTextContent('source-node-7')
  })
})
