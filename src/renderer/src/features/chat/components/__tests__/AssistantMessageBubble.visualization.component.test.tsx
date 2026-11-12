import { SessionId } from '@shared/types/brand'
import type { UIMessage, UIMessagePart } from '@shared/types/chat-ui'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearInlineVisualizationStatesForTests,
  latestInlineVisualizationContext,
} from '../../state/inline-visualization-state'
import { clearPinnedInlineVisualizationFramesForTests } from '../inline-visualization-frame-retention'

const ipc = vi.hoisted(() => ({
  registerInlineVisualizationFrame: vi.fn(
    async (input: { readonly frameId: string; readonly sessionId: string }) => ({
      frameUrl: `openwaggle-visualization://frame-${input.frameId}/document`,
      registrationId: `registration-${input.frameId}`,
    }),
  ),
  unregisterInlineVisualizationFrame: vi.fn(async () => undefined),
}))

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi(ipc),
}))

// The syntax service highlights in Web Workers, which jsdom lacks; nothing here highlights code.
vi.mock('@/shared/lib/syntax/syntax-service', () => ({
  syntaxService: { highlight: async () => ({ status: 'plain-text', lines: [], elapsedMs: 0 }) },
}))

import { AssistantMessageBubble } from '../AssistantMessageBubble'
import {
  activateFrame,
  dispatchFrameMessage,
  visualizationFrame,
} from './inline-visualization-test-helpers'

/*
 * Only the preload is replaced: the bubble, its Markdown and the inline visualization frame are the
 * real ones, so a case asserts which Session the frame loads from and which one it reports to.
 */
const currentSessionId = SessionId('session-1')

function visualize(title: string) {
  return `visualize{"path":"/repo/${title}.html","title":"${title}"}`
}

function renderMessage(parts: UIMessagePart[], metadata?: UIMessage['metadata']) {
  return render(
    <AssistantMessageBubble
      message={{ id: 'message-1', role: 'assistant', parts, ...(metadata ? { metadata } : {}) }}
      runtime={{
        sessionId: currentSessionId,
        extensions: { registry: null, projectPaths: [] },
      }}
    />,
  )
}

describe('AssistantMessageBubble visualization ownership', () => {
  afterEach(() => {
    ipc.registerInlineVisualizationFrame.mockClear()
    clearInlineVisualizationStatesForTests()
    clearPinnedInlineVisualizationFramesForTests()
  })

  it('loads a copied message from its source Session and reports state to the current one', async () => {
    renderMessage([{ type: 'text', content: visualize('Copied') }], {
      visualizationSessionId: SessionId('source-session'),
    })

    const frame = await visualizationFrame('Copied')
    expect(ipc.registerInlineVisualizationFrame).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'source-session', sourcePath: '/repo/Copied.html' }),
    )
    await activateFrame(frame)
    act(() => {
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:state',
        state: { selected: 'api' },
      })
    })

    await waitFor(() => {
      expect(latestInlineVisualizationContext(currentSessionId)).toEqual({
        title: 'Copied',
        sourcePath: '/repo/Copied.html',
        state: { selected: 'api' },
      })
    })
  })

  it('mounts a visualization only from assistant-authored text', async () => {
    renderMessage([
      { type: 'text', content: visualize('Authored') },
      {
        type: 'tool-result',
        toolCallId: 'tool-1',
        content: visualize('Tool'),
        state: 'output-available',
      },
      { type: 'thinking', content: visualize('Thinking') },
    ])

    await visualizationFrame('Authored')
    expect(ipc.registerInlineVisualizationFrame).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: currentSessionId }),
    )
    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(screen.queryByRole('region', { name: 'Tool' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Thinking' })).toBeNull()
  })
})
