import type { StreamChunk } from '@tanstack/ai'
import { describe, expect, it } from 'vitest'
import { StreamPartCollector } from './stream-part-collector'

describe('StreamPartCollector', () => {
  it('collects text, tool calls, and tool results', () => {
    const collector = new StreamPartCollector()

    collector.handleChunk({
      type: 'TEXT_MESSAGE_CONTENT',
      timestamp: 1,
      delta: 'Before tool. ',
    } as StreamChunk)

    const start = collector.handleChunk({
      type: 'TOOL_CALL_START',
      timestamp: 2,
      toolCallId: 'tool-1',
      toolName: 'readFile',
    } as StreamChunk)

    collector.handleChunk({
      type: 'TOOL_CALL_ARGS',
      timestamp: 3,
      toolCallId: 'tool-1',
      delta: '{"path":"README.md"}',
    } as StreamChunk)

    const end = collector.handleChunk({
      type: 'TOOL_CALL_END',
      timestamp: 4,
      toolCallId: 'tool-1',
      toolName: 'readFile',
      result: { kind: 'text', text: 'contents' },
    } as unknown as StreamChunk)

    collector.handleChunk({
      type: 'TEXT_MESSAGE_CONTENT',
      timestamp: 5,
      delta: 'After tool.',
    } as StreamChunk)

    const parts = collector.finalizeParts()
    const stats = collector.getStats()

    expect(start.toolCallStart?.toolName).toBe('readFile')
    expect(end.toolCallEnd?.result).toBe('{"kind":"text","text":"contents"}')
    expect(stats.toolCalls).toBe(1)
    expect(stats.toolErrors).toBe(0)

    expect(parts).toEqual([
      { type: 'text', text: 'Before tool. ' },
      {
        type: 'tool-call',
        toolCall: {
          id: 'tool-1',
          name: 'readFile',
          args: { path: 'README.md' },
        },
      },
      {
        type: 'tool-result',
        toolResult: {
          id: 'tool-1',
          name: 'readFile',
          args: { path: 'README.md' },
          result: '{"kind":"text","text":"contents"}',
          isError: false,
          duration: expect.any(Number),
        },
      },
      { type: 'text', text: 'After tool.' },
    ])
  })

  it('marks tool result as error when contract includes an error field', () => {
    const collector = new StreamPartCollector()

    collector.handleChunk({
      type: 'TOOL_CALL_START',
      timestamp: 1,
      toolCallId: 'tool-2',
      toolName: 'runCommand',
    } as StreamChunk)

    collector.handleChunk({
      type: 'TOOL_CALL_ARGS',
      timestamp: 1.5,
      toolCallId: 'tool-2',
      delta: '{}',
    } as StreamChunk)

    collector.handleChunk({
      type: 'TOOL_CALL_END',
      timestamp: 2,
      toolCallId: 'tool-2',
      toolName: 'runCommand',
      result: { ok: false, error: 'command failed' },
    } as unknown as StreamChunk)

    const parts = collector.finalizeParts()
    const stats = collector.getStats()

    expect(stats.toolCalls).toBe(1)
    expect(stats.toolErrors).toBe(1)

    expect(parts[1]).toEqual({
      type: 'tool-result',
      toolResult: {
        id: 'tool-2',
        name: 'runCommand',
        args: {},
        result: '{"ok":false,"error":"command failed"}',
        isError: true,
        duration: expect.any(Number),
      },
    })
  })

  it('does not duplicate persisted tool-call parts across repeated TOOL_CALL_END chunks', () => {
    const collector = new StreamPartCollector()

    collector.handleChunk({
      type: 'TOOL_CALL_START',
      timestamp: 1,
      toolCallId: 'tool-3',
      toolName: 'writeFile',
    } as StreamChunk)

    collector.handleChunk({
      type: 'TOOL_CALL_ARGS',
      timestamp: 1.5,
      toolCallId: 'tool-3',
      delta: '{"path":"SUMMARY.md"}',
    } as StreamChunk)

    collector.handleChunk({
      type: 'TOOL_CALL_END',
      timestamp: 2,
      toolCallId: 'tool-3',
      toolName: 'writeFile',
    } as unknown as StreamChunk)

    collector.handleChunk({
      type: 'TOOL_CALL_END',
      timestamp: 3,
      toolCallId: 'tool-3',
      toolName: 'writeFile',
      result: { kind: 'text', text: 'ok' },
    } as unknown as StreamChunk)

    const parts = collector.finalizeParts()
    const stats = collector.getStats()

    expect(stats.toolCalls).toBe(1)
    expect(parts.filter((part) => part.type === 'tool-call')).toHaveLength(1)
    expect(parts.filter((part) => part.type === 'tool-result')).toHaveLength(1)
  })

  it('appends run errors as markdown error text', () => {
    const collector = new StreamPartCollector()

    const result = collector.handleChunk({
      type: 'RUN_ERROR',
      timestamp: 1,
      error: { message: 'boom' },
    } as StreamChunk)

    const parts = collector.finalizeParts()

    expect(result.runError?.message).toBe('boom')
    expect(parts).toEqual([{ type: 'text', text: '\n\n**Error:** boom' }])
  })
})
