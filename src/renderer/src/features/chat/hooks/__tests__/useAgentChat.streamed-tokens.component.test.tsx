import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupWorkerTranscript,
  emit,
  loadWorkerTranscriptHooks,
  MODEL,
  resetWorkerTranscriptState,
  settle,
  transcriptText,
  workerDetailWithoutRunMessages,
} from './worker-session-transcript.test-harness'

/*
 * A streamed token re-rendered the whole chat route: it replaced the chat's message list in React
 * state, and everything reading the list (transcript, Session Summary, composer) rendered again
 * once per token (B2). Tokens now reach only the streaming message's bubble.
 */

const { useAgentChat, useBackgroundRunMonitor } = await loadWorkerTranscriptHooks()
const { AssistantMessageBubble } = await import('../../components/AssistantMessageBubble')
const SESSION_ID = workerDetailWithoutRunMessages().id
const TOKENS = 200

function streamToken(delta: string, timestamp: number) {
  emit({
    type: 'message_update',
    messageId: 'answer',
    role: 'assistant',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta },
    timestamp,
  })
}

describe('streamed tokens', () => {
  beforeEach(resetWorkerTranscriptState)
  afterEach(cleanupWorkerTranscript)

  async function streamingChat() {
    renderHook(() => useBackgroundRunMonitor())
    let renders = 0
    const chat = renderHook(() => {
      renders += 1
      return useAgentChat(SESSION_ID, workerDetailWithoutRunMessages(), MODEL)
    })
    await settle()
    act(() => {
      emit({ type: 'agent_start', runId: 'run-1', model: String(MODEL), timestamp: 1 })
      emit({ type: 'message_start', messageId: 'answer', role: 'assistant', timestamp: 2 })
      streamToken('Hello', 3)
    })
    return { chat, renders: () => renders }
  }

  it('do not re-render the chat once per token', async () => {
    const { chat, renders } = await streamingChat()
    const before = renders()

    // Each token arrives in its own IPC task.
    for (let index = 0; index < TOKENS; index += 1) act(() => streamToken(' word', 10 + index))

    expect(renders() - before).toBe(0)
    expect(transcriptText(chat.result.current.messages).at(-1)?.[1]).toBe(
      `Hello${' word'.repeat(TOKENS)}`,
    )
  })

  it("reach the streaming message's bubble, and the chat's state at the next change", async () => {
    const { chat } = await streamingChat()
    const shown = chat.result.current.messages.at(-1)
    if (!shown) throw new Error('The streaming message is not shown.')
    render(
      <AssistantMessageBubble
        message={shown}
        runtime={{ sessionId: SESSION_ID, extensions: { registry: null, projectPaths: [] } }}
        run={{ isStreaming: true, isRunActive: true }}
        presentation={{ hideAgentLabel: true }}
      />,
    )

    act(() => streamToken(' there, streaming', 20))
    expect(screen.getByText('Hello there, streaming')).toBeInTheDocument()

    act(() => emit({ type: 'message_end', messageId: 'answer', role: 'assistant', timestamp: 30 }))
    const committed = chat.result.current.messages.at(-1)
    expect(committed?.parts).toEqual([{ type: 'text', content: 'Hello there, streaming' }])
  })
})
