import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface ViewerProps {
  readonly activeMessageIds: ReadonlySet<string>
  readonly activePathNodeIds: readonly string[]
}

const viewer = vi.hoisted(() => {
  const props: ViewerProps[] = []
  return { props }
})

vi.mock('@/features/session-summary/components/SessionResourceViewer', () => ({
  SessionResourceViewer: (props: ViewerProps) => {
    viewer.props.push(props)
    return null
  },
}))

import { createSections, makeMessage } from './ChatPanel.test-utils'
import {
  chatPanelElement,
  preloadSessionSummaryOverlay,
  renderPanelSettled,
  SESSION,
  setupChatPanelSessionSummaryHarness,
  useChatPanelSectionsMock,
} from './chat-panel-session-summary.test-harness'

/**
 * The chat panel derives the shown messages' node ids for the Session Summary and the resource
 * viewer. The message list is a new array whenever any message changes, so the ids were rebuilt
 * and both re-rendered on every change, though the ids rarely change (B2).
 */
describe('ChatPanel derived message ids', () => {
  preloadSessionSummaryOverlay()

  beforeEach(() => {
    setupChatPanelSessionSummaryHarness()
    viewer.props.length = 0
  })

  it('keeps the id lists while only message content changes', async () => {
    const user = makeMessage({ id: 'u1', role: 'user', parts: [{ type: 'text', content: 'Hi' }] })
    const answer = (content: string) =>
      makeMessage({ id: 'a1', role: 'assistant', parts: [{ type: 'text', content }] })
    const view = await renderPanelSettled({ messages: [user, answer('Hel')] }, { session: SESSION })
    await waitFor(() => expect(viewer.props.length).toBeGreaterThan(0))
    const first = viewer.props.at(-1)

    useChatPanelSectionsMock.mockReturnValue(
      createSections({ messages: [user, answer('Hello there')] }, { session: SESSION }),
    )
    act(() => view.rerender(chatPanelElement()))

    const latest = viewer.props.at(-1)
    expect(latest?.activePathNodeIds).toBe(first?.activePathNodeIds)
    expect(latest?.activeMessageIds).toBe(first?.activeMessageIds)
    expect([...(latest?.activeMessageIds ?? [])]).toEqual(['u1', 'a1'])
  })

  it('derives new lists when the ids change', async () => {
    const user = makeMessage({ id: 'u1', role: 'user', parts: [] })
    const view = await renderPanelSettled({ messages: [user] }, { session: SESSION })
    await waitFor(() => expect(viewer.props.length).toBeGreaterThan(0))
    const first = viewer.props.at(-1)

    useChatPanelSectionsMock.mockReturnValue(
      createSections(
        { messages: [user, makeMessage({ id: 'a1', role: 'assistant', parts: [] })] },
        { session: SESSION },
      ),
    )
    act(() => view.rerender(chatPanelElement()))

    expect(viewer.props.at(-1)?.activePathNodeIds).not.toBe(first?.activePathNodeIds)
    expect(viewer.props.at(-1)?.activePathNodeIds).toEqual(['u1', 'a1'])
  })
})
