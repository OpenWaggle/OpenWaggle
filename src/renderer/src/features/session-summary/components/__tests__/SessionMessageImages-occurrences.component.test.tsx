import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { fireEvent, screen } from '@testing-library/react'
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

function agentImage(id: string, nodeId: string): SessionResource {
  const resource = image(id, nodeId)
  return {
    ...resource,
    isSource: false,
    isOutput: true,
    occurrences: resource.occurrences.map((occurrence) => ({
      ...occurrence,
      actor: 'agent' as const,
      activity: 'created' as const,
    })),
  }
}

function renderAgentImages() {
  renderWithQueryClient(
    <SessionMessageResourcesProvider sessionId={SessionId('session-1')} nodeIds={['agent-message']}>
      <SessionMessageImages messageId="agent-message" />
    </SessionMessageResourcesProvider>,
  )
}

describe('SessionMessageImages occurrence ordering', () => {
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

  it('keeps attachment order and repeated user images as separate gallery positions', async () => {
    const repeated = image('same', 'message-1')
    listSessionResources.mockResolvedValue([
      {
        ...repeated,
        occurrences: [
          { ...repeated.occurrences[0], id: 'session-1:message-1:provided:attachment:a:2' },
          { ...repeated.occurrences[0], id: 'session-1:message-1:provided:attachment:b:0' },
        ],
      },
      {
        ...image('middle', 'message-1'),
        occurrences: [
          {
            ...image('middle', 'message-1').occurrences[0],
            id: 'session-1:message-1:provided:attachment:c:1',
          },
        ],
      },
    ])
    renderWithQueryClient(
      <SessionMessageResourcesProvider sessionId={SessionId('session-1')} nodeIds={['message-1']}>
        <SessionMessageImages messageId="message-1" />
      </SessionMessageResourcesProvider>,
    )

    const buttons = await screen.findAllByRole('button', { name: /^Open image / })
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Open image same.png',
      'Open image middle.png',
      'Open image same.png',
    ])
    fireEvent.click(buttons[2])
    expect(useUIStore.getState().resourceViewer).toEqual({
      sessionId: 'session-1',
      resourceId: 'same',
      galleryResourceIds: ['same', 'middle', 'same'],
      galleryIndex: 2,
    })
  })

  it('keeps generated agent image order when resource ids sort differently', async () => {
    const late = agentImage('a-late', 'agent-message')
    const early = agentImage('z-early', 'agent-message')
    listSessionResources.mockResolvedValue([
      {
        ...late,
        occurrences: [
          { ...late.occurrences[0], id: 'session-1:agent-message:created:image:1:hash' },
        ],
      },
      {
        ...early,
        occurrences: [
          { ...early.occurrences[0], id: 'session-1:agent-message:created:image:0:hash' },
        ],
      },
    ])
    renderAgentImages()

    const buttons = await screen.findAllByRole('button', { name: /^Open image / })
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Open image z-early.png',
      'Open image a-late.png',
    ])
  })

  it('keeps remote Markdown image order for the same agent message', async () => {
    const late = remoteImage('a-late', 'agent-message')
    const early = remoteImage('z-early', 'agent-message')
    listSessionResources.mockResolvedValue([
      {
        ...late,
        occurrences: [{ ...late.occurrences[0], id: 'session-1:agent-message:read:link:1:hash' }],
      },
      {
        ...early,
        occurrences: [{ ...early.occurrences[0], id: 'session-1:agent-message:read:link:0:hash' }],
      },
    ])
    renderAgentImages()

    const buttons = await screen.findAllByRole('button', { name: /^Open image / })
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Open image z-early.png',
      'Open image a-late.png',
    ])
  })

  it('uses an agent output image title rather than its tool provenance label', async () => {
    const output = agentImage('tool-output', 'agent-message')
    listSessionResources.mockResolvedValue([
      {
        ...output,
        occurrences: output.occurrences.map((occurrence) => ({
          ...occurrence,
          actor: 'tool' as const,
          label: 'imagegen',
        })),
      },
    ])
    renderAgentImages()

    expect(await screen.findByRole('button', { name: 'Open image tool-output.png' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Open image imagegen' })).toBeNull()
  })

  it('uses the current attachment name when deduplicated bytes retain an older resource title', async () => {
    const reused = image('old', 'message-1')
    listSessionResources.mockResolvedValue([
      {
        ...reused,
        title: 'old-name.png',
        occurrences: [
          {
            ...reused.occurrences[0],
            id: 'session-1:message-1:provided:attachment:renamed:0',
          },
        ],
      },
    ])
    renderWithQueryClient(
      <SessionMessageResourcesProvider sessionId={SessionId('session-1')} nodeIds={['message-1']}>
        <SessionMessageImages messageId="message-1" attachmentNames={['new-name.png']} />
      </SessionMessageResourcesProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Open image new-name.png' }))
    expect(useUIStore.getState().resourceViewer).toMatchObject({
      resourceId: 'old',
      galleryTitles: ['new-name.png'],
    })
  })

  it('orders linked and generated images using their shared message position', async () => {
    const generated = agentImage('a-generated', 'agent-message')
    const linked = remoteImage('z-linked', 'agent-message')
    listSessionResources.mockResolvedValue([
      { ...generated, occurrences: [{ ...generated.occurrences[0], displayOrder: 1 }] },
      { ...linked, occurrences: [{ ...linked.occurrences[0], displayOrder: 0 }] },
    ])
    renderAgentImages()

    const buttons = await screen.findAllByRole('button', { name: /^Open image / })
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Open image z-linked.png',
      'Open image a-generated.png',
    ])
  })

  it('uses a reused agent image occurrence name without replacing tool provenance', async () => {
    const reused = agentImage('reused', 'agent-message')
    listSessionResources.mockResolvedValue([
      {
        ...reused,
        title: 'original.png',
        occurrences: [
          {
            ...reused.occurrences[0],
            actor: 'tool',
            label: 'imagegen',
            displayName: 'new-name.png',
          },
        ],
      },
    ])
    renderAgentImages()

    fireEvent.click(await screen.findByRole('button', { name: 'Open image new-name.png' }))
    expect(useUIStore.getState().resourceViewer?.galleryTitles).toEqual(['new-name.png'])
  })

  it('keeps a user attachment before a linked image even when both have position zero', async () => {
    const attachment = image('attachment', 'message-1')
    const link = remoteImage('linked', 'message-1')
    listSessionResources.mockResolvedValue([
      {
        ...link,
        occurrences: [{ ...link.occurrences[0], id: 'session-1:message-1:provided:link:0:hash' }],
      },
      {
        ...attachment,
        occurrences: [
          { ...attachment.occurrences[0], id: 'session-1:message-1:provided:attachment:a:0' },
        ],
      },
    ])
    renderWithQueryClient(
      <SessionMessageResourcesProvider sessionId={SessionId('session-1')} nodeIds={['message-1']}>
        <SessionMessageImages messageId="message-1" />
      </SessionMessageResourcesProvider>,
    )

    const buttons = await screen.findAllByRole('button', { name: /^Open image / })
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Open image attachment.png',
      'Open image linked.png',
    ])
  })
})
