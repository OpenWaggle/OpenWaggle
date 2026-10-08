import type { AssistantMessage, AssistantMessageEvent, ToolCall } from '@earendil-works/pi-ai'
import { SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { describe, expect, it } from 'vitest'
import {
  splitIntoDeltas,
  streamBedrockFrames,
  toolCallFrames,
  writeFileArguments,
} from '../../__tests__/bedrock-event-stream.test-utils'
import { createSessionListener } from '../session-listener'

/**
 * OpenWaggle's projection copied a streaming tool call's whole input into every
 * `toolcall_delta` transport event, and each copy is serialized to the Host socket, decoded
 * by the GUI, cloned over IPC, and re-stringified by the renderer: O(n) bytes per delta and
 * about 1.2 GB for one 200 KB tool call. The input is now sent only when Pi re-parsed it.
 */

const MODEL = SupportedModelId('amazon-bedrock/eu.anthropic.claude-haiku-4-5-20251001-v1:0')

function recordTransportEvents() {
  const emitted: AgentTransportEvent[] = []
  const listener = createSessionListener(
    { model: MODEL, sessionEntries: null, onEvent: (event) => emitted.push(event) },
    'run-1',
  )
  const onPiEvent = (assistantMessageEvent: AssistantMessageEvent) => {
    const message =
      'partial' in assistantMessageEvent
        ? assistantMessageEvent.partial
        : 'message' in assistantMessageEvent
          ? assistantMessageEvent.message
          : assistantMessageEvent.error
    listener({ type: 'message_update', message, assistantMessageEvent })
  }
  const toolCallEvents = () =>
    emitted.flatMap((event) =>
      event.type === 'message_update' ? [event.assistantMessageEvent] : [],
    )
  const deltas = () =>
    toolCallEvents().flatMap((event) => (event.type === 'toolcall_delta' ? [event] : []))
  const end = () => toolCallEvents().find((event) => event.type === 'toolcall_end')
  return { onPiEvent, deltas, end }
}

function piMessage(toolCall: ToolCall): AssistantMessage {
  return {
    role: 'assistant',
    content: [toolCall],
    api: 'bedrock-converse-stream',
    provider: 'amazon-bedrock',
    model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'pending',
    timestamp: 0,
  }
}

describe('session listener streaming tool-call input', () => {
  it('holds deltas back while Pi keeps the same arguments object and sends them with the next input', () => {
    const recorder = recordTransportEvents()
    const toolCall: ToolCall = { type: 'toolCall', id: 'tool-1', name: 'write', arguments: {} }
    const partial = piMessage(toolCall)
    const delta = (text: string) =>
      recorder.onPiEvent({ type: 'toolcall_delta', contentIndex: 0, delta: text, partial })

    recorder.onPiEvent({ type: 'toolcall_start', contentIndex: 0, partial })
    toolCall.arguments = { path: 'a' }
    delta('{"path":"a"')
    delta(',"content":"x')
    delta('yz')
    toolCall.arguments = { path: 'a', content: 'xyz' }
    delta('"}')
    recorder.onPiEvent({ type: 'toolcall_end', contentIndex: 0, toolCall, partial })

    expect(recorder.deltas()).toEqual([
      expect.objectContaining({ delta: '{"path":"a"', input: { path: 'a' } }),
      expect.objectContaining({ delta: ',"content":"xyz"}', input: { path: 'a', content: 'xyz' } }),
    ])
    expect(recorder.end()).toMatchObject({ input: { path: 'a', content: 'xyz' } })
  })

  it('sends a large Bedrock tool input a bounded number of times and ends exact', async () => {
    const json = writeFileArguments(200 * 1024)
    const piDeltas = splitIntoDeltas(json)
    const recorder = recordTransportEvents()

    await streamBedrockFrames(toolCallFrames(piDeltas, { stopBlock: true }), recorder.onPiEvent)

    const deltas = recorder.deltas()
    const inputBytes = deltas.reduce(
      (total, event) => total + JSON.stringify(event.input ?? null).length,
      0,
    )
    // Unpatched: one event per Pi delta, about 5,000 times the input size in total.
    expect(deltas.length).toBeLessThan(piDeltas.length / 10)
    expect(inputBytes).toBeLessThan(50 * json.length)
    expect(deltas.every((event) => event.input !== undefined)).toBe(true)
    expect(json.startsWith(deltas.map((event) => event.delta).join(''))).toBe(true)
    expect(recorder.end()).toMatchObject({ toolCallId: 'tool-1', input: JSON.parse(json) })
  })

  it('still sends a small Bedrock tool input with every delta', async () => {
    const json = writeFileArguments(2 * 1024)
    const piDeltas = splitIntoDeltas(json)
    const recorder = recordTransportEvents()

    await streamBedrockFrames(toolCallFrames(piDeltas, { stopBlock: true }), recorder.onPiEvent)

    expect(recorder.deltas().map((event) => event.delta)).toEqual(piDeltas)
    expect(recorder.end()).toMatchObject({ input: JSON.parse(json) })
  })
})
