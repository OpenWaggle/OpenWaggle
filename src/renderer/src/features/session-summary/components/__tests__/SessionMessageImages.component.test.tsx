import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { SessionMessageImages } from '../SessionMessageImages'

const listSessionResources = vi.hoisted(() => vi.fn())
const readSessionResource = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: { listSessionResources, readSessionResource },
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
        createdAt: 1000,
      },
    ],
    createdAt: 1000,
    updatedAt: 1000,
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
      dataBase64: 'aW1hZ2U=',
    })
  })

  it('renders only images attached to this message and opens the session viewer', async () => {
    renderWithQueryClient(
      <SessionMessageImages sessionId={SessionId('session-1')} messageId="message-1" />,
    )

    const imageButton = await screen.findByRole('button', { name: 'Open image matching.png' })
    expect(screen.queryByRole('button', { name: 'Open image other-message.png' })).toBeNull()

    fireEvent.click(imageButton)
    expect(useUIStore.getState().resourceViewer).toEqual({
      sessionId: 'session-1',
      resourceId: 'matching',
    })
  })
})
