import type {
  CustomEvent,
  RunErrorEvent,
  StepFinishedEvent,
  StepStartedEvent,
  TextMessageContentEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallStartEvent,
} from '@tanstack/ai'
import { describe, expect, it } from 'vitest'
import { StreamPartCollector } from './stream-part-collector'

function textContent(delta: string, ts = 0): TextMessageContentEvent {
  return { type: 'TEXT_MESSAGE_CONTENT', timestamp: ts, messageId: 'm1', delta }
}

function stepStarted(stepId: string, ts = 0): StepStartedEvent {
  return { type: 'STEP_STARTED', timestamp: ts, stepId }
}

function stepFinished(stepId: string, delta: string, ts = 0): StepFinishedEvent {
  return { type: 'STEP_FINISHED', timestamp: ts, stepId, delta }
}

function toolCallStart(toolCallId: string, toolName: string, ts = 0): ToolCallStartEvent {
  return { type: 'TOOL_CALL_START', timestamp: ts, toolCallId, toolName }
}

function toolCallArgs(toolCallId: string, delta: string, ts = 0): ToolCallArgsEvent {
  return { type: 'TOOL_CALL_ARGS', timestamp: ts, toolCallId, delta }
}

function toolCallEnd(
  toolCallId: string,
  toolName: string,
  result?: string,
  ts = 0,
): ToolCallEndEvent {
  return { type: 'TOOL_CALL_END', timestamp: ts, toolCallId, toolName, result }
}

function runError(message: string, ts = 0): RunErrorEvent {
  return { type: 'RUN_ERROR', timestamp: ts, error: { message } }
}

function customEvent(name: string, data: unknown, ts = 0): CustomEvent {
  return { type: 'CUSTOM', timestamp: ts, name, value: data }
}

describe('StreamPartCollector', () => {
  it('collects text, tool calls, and tool results', () => {
    const collector = new StreamPartCollector()

    collector.handleChunk(textContent('Before tool. ', 1))

    const start = collector.handleChunk(toolCallStart('tool-1', 'readFile', 2))

    collector.handleChunk(toolCallArgs('tool-1', '{"path":"README.md"}', 3))

    const end = collector.handleChunk(
      toolCallEnd('tool-1', 'readFile', '{"kind":"text","text":"contents"}', 4),
    )

    collector.handleChunk(textContent('After tool.', 5))

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

    collector.handleChunk(toolCallStart('tool-2', 'runCommand', 1))
    collector.handleChunk(toolCallArgs('tool-2', '{}', 1.5))
    collector.handleChunk(
      toolCallEnd('tool-2', 'runCommand', '{"ok":false,"error":"command failed"}', 2),
    )

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

    collector.handleChunk(toolCallStart('tool-3', 'writeFile', 1))
    collector.handleChunk(toolCallArgs('tool-3', '{"path":"SUMMARY.md"}', 1.5))
    collector.handleChunk(toolCallEnd('tool-3', 'writeFile', undefined, 2))
    collector.handleChunk(toolCallEnd('tool-3', 'writeFile', '{"kind":"text","text":"ok"}', 3))

    const parts = collector.finalizeParts()
    const stats = collector.getStats()

    expect(stats.toolCalls).toBe(1)
    expect(parts.filter((part) => part.type === 'tool-call')).toHaveLength(1)
    expect(parts.filter((part) => part.type === 'tool-result')).toHaveLength(1)
  })

  it('preserves unresolved tool call when TOOL_CALL_END has no result payload on normal completion', () => {
    const collector = new StreamPartCollector()

    collector.handleChunk(toolCallStart('tool-4', 'writeFile', 1))
    collector.handleChunk(toolCallArgs('tool-4', '{"path":"out.txt"}', 2))
    collector.handleChunk(toolCallEnd('tool-4', 'writeFile', undefined, 3))

    expect(collector.hasIncompleteToolCalls()).toBe(true)
    expect(collector.hasUnresolvedToolResults()).toBe(true)

    const parts = collector.finalizeParts()
    const stats = collector.getStats()
    const toolResultPart = parts.find((part) => part.type === 'tool-result')
    const toolCallPart = parts.find((part) => part.type === 'tool-call')

    expect(toolResultPart).toBeUndefined()
    expect(toolCallPart).toEqual({
      type: 'tool-call',
      toolCall: {
        id: 'tool-4',
        name: 'writeFile',
        args: { path: 'out.txt' },
      },
    })
    expect(stats.toolCalls).toBe(1)
    expect(stats.toolErrors).toBe(0)
  })

  it('preserves unresolved tool call when approval-requested custom events are present', () => {
    const collector = new StreamPartCollector()

    collector.handleChunk(toolCallStart('tool-4a', 'writeFile', 1))
    collector.handleChunk(toolCallArgs('tool-4a', '{"path":"out.txt"}', 2))
    collector.handleChunk(
      customEvent(
        'approval-requested',
        {
          toolCallId: 'tool-4a',
          toolName: 'writeFile',
          input: { path: 'out.txt' },
          approval: { id: 'approval_tool-4a', needsApproval: true },
        },
        2.5,
      ),
    )
    collector.handleChunk(toolCallEnd('tool-4a', 'writeFile', undefined, 3))

    const parts = collector.finalizeParts()
    const stats = collector.getStats()
    const toolResultPart = parts.find((part) => part.type === 'tool-result')
    const toolCallPart = parts.find((part) => part.type === 'tool-call')

    expect(toolResultPart).toBeUndefined()
    expect(toolCallPart).toEqual({
      type: 'tool-call',
      toolCall: {
        id: 'tool-4a',
        name: 'writeFile',
        args: { path: 'out.txt' },
      },
    })
    expect(stats.toolCalls).toBe(1)
    expect(stats.toolErrors).toBe(0)
  })

  it('synthesizes unresolved tool result when explicitly requested unresolved id is not preserved', () => {
    const collector = new StreamPartCollector()

    collector.handleChunk(toolCallStart('tool-4a-explicit', 'writeFile', 1))
    collector.handleChunk(toolCallArgs('tool-4a-explicit', '{"path":"out.txt"}', 2))
    collector.handleChunk(toolCallEnd('tool-4a-explicit', 'writeFile', undefined, 3))

    const parts = collector.finalizeParts({ timedOut: true })
    const stats = collector.getStats()
    const toolResultPart = parts.find((part) => part.type === 'tool-result')

    expect(toolResultPart).toEqual({
      type: 'tool-result',
      toolResult: {
        id: 'tool-4a-explicit',
        name: 'writeFile',
        args: { path: 'out.txt' },
        result: expect.stringContaining('Tool call did not complete before the stream ended.'),
        isError: true,
        duration: expect.any(Number),
      },
    })
    expect(stats.toolCalls).toBe(1)
    expect(stats.toolErrors).toBe(1)
  })

  it('preserves explicitly requested unresolved tool calls', () => {
    const collector = new StreamPartCollector()

    collector.handleChunk(toolCallStart('tool-4c', 'writeFile', 1))
    collector.handleChunk(toolCallArgs('tool-4c', '{"path":"out.txt"}', 2))
    collector.handleChunk(toolCallEnd('tool-4c', 'writeFile', undefined, 3))

    const parts = collector.finalizeParts({
      preserveUnresolvedToolCallIds: new Set(['tool-4c']),
    })
    const stats = collector.getStats()
    const toolResultPart = parts.find((part) => part.type === 'tool-result')

    expect(toolResultPart).toBeUndefined()
    expect(stats.toolCalls).toBe(1)
    expect(stats.toolErrors).toBe(0)
  })

  it('synthesizes an error tool-result when TOOL_CALL_END has no result payload after timeout', () => {
    const collector = new StreamPartCollector()

    collector.handleChunk(toolCallStart('tool-4b', 'writeFile', 1))
    collector.handleChunk(toolCallArgs('tool-4b', '{"path":"out.txt"}', 2))
    collector.handleChunk(toolCallEnd('tool-4b', 'writeFile', undefined, 3))

    const parts = collector.finalizeParts({ timedOut: true })
    const stats = collector.getStats()
    const toolResultPart = parts.find((part) => part.type === 'tool-result')

    expect(toolResultPart).toEqual({
      type: 'tool-result',
      toolResult: {
        id: 'tool-4b',
        name: 'writeFile',
        args: { path: 'out.txt' },
        result: expect.stringContaining('Tool call did not complete before the stream ended.'),
        isError: true,
        duration: expect.any(Number),
      },
    })
    expect(stats.toolCalls).toBe(1)
    expect(stats.toolErrors).toBe(1)
  })

  it('synthesizes missing tool-call + tool-result when stream ends after TOOL_CALL_START', () => {
    const collector = new StreamPartCollector()

    collector.handleChunk(toolCallStart('tool-5', 'editFile', 1))
    collector.handleChunk(toolCallArgs('tool-5', '{"path":"src/a.ts"}', 2))

    expect(collector.hasIncompleteToolCalls()).toBe(true)
    expect(collector.hasUnresolvedToolResults()).toBe(false)

    const parts = collector.finalizeParts()
    const stats = collector.getStats()

    expect(parts).toEqual([
      {
        type: 'tool-call',
        toolCall: {
          id: 'tool-5',
          name: 'editFile',
          args: { path: 'src/a.ts' },
        },
      },
      {
        type: 'tool-result',
        toolResult: {
          id: 'tool-5',
          name: 'editFile',
          args: { path: 'src/a.ts' },
          result: expect.stringContaining('Tool call did not complete before the stream ended.'),
          isError: true,
          duration: expect.any(Number),
        },
      },
    ])
    expect(stats.toolCalls).toBe(1)
    expect(stats.toolErrors).toBe(1)
  })

  it('accumulates incremental reasoning deltas into one part per step', () => {
    const collector = new StreamPartCollector()

    // Anthropic adapter emits STEP_FINISHED per reasoning token, all same stepId
    collector.handleChunk(stepStarted('step-1', 1))
    collector.handleChunk(stepFinished('step-1', 'Planning ', 2))
    collector.handleChunk(stepFinished('step-1', 'the ', 3))
    collector.handleChunk(stepFinished('step-1', 'approach...', 4))

    collector.handleChunk(textContent('Final answer.', 5))

    const parts = collector.finalizeParts()

    expect(parts).toEqual([
      { type: 'reasoning', text: 'Planning the approach...' },
      { type: 'text', text: 'Final answer.' },
    ])
  })

  it('creates separate reasoning parts for distinct reasoning steps', () => {
    const collector = new StreamPartCollector()

    // Step 1: planner reasoning
    collector.handleChunk(stepStarted('step-1', 1))
    collector.handleChunk(stepFinished('step-1', 'Planning...', 2))

    // Step 2: executor reasoning (new STEP_STARTED flushes previous)
    collector.handleChunk(stepStarted('step-2', 3))
    collector.handleChunk(stepFinished('step-2', 'Executing...', 4))

    collector.handleChunk(textContent('Done.', 5))

    const parts = collector.finalizeParts()

    expect(parts).toEqual([
      { type: 'reasoning', text: 'Planning...' },
      { type: 'reasoning', text: 'Executing...' },
      { type: 'text', text: 'Done.' },
    ])
  })

  it('flushes reasoning when text content arrives without STEP_STARTED boundary', () => {
    const collector = new StreamPartCollector()

    // Thinking deltas arrive, then text without an intervening STEP_STARTED
    collector.handleChunk(stepStarted('step-1', 1))
    collector.handleChunk(stepFinished('step-1', 'Thinking...', 2))
    collector.handleChunk(textContent('Response text.', 3))

    const parts = collector.finalizeParts()

    expect(parts).toEqual([
      { type: 'reasoning', text: 'Thinking...' },
      { type: 'text', text: 'Response text.' },
    ])
  })

  it('skips empty reasoning parts from STEP_FINISHED with no delta', () => {
    const collector = new StreamPartCollector()

    collector.handleChunk(stepStarted('step-1', 1))
    collector.handleChunk(stepFinished('step-1', '', 2))

    collector.handleChunk(textContent('Response text.', 3))

    const parts = collector.finalizeParts()

    expect(parts).toEqual([{ type: 'text', text: 'Response text.' }])
  })

  it('appends run errors as markdown error text', () => {
    const collector = new StreamPartCollector()

    const result = collector.handleChunk(runError('boom', 1))

    const parts = collector.finalizeParts()

    expect(result.runError?.message).toBe('boom')
    expect(parts).toEqual([{ type: 'text', text: '\n\n**Error:** boom' }])
  })
})
