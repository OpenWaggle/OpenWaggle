import type { UIMessage } from '@tanstack/ai-react'
import { describe, expect, it } from 'vitest'
import { findPendingApproval } from './pending-tool-interactions'

function makeApprovalToolCall(
  id: string,
  approvalId: string,
  state: 'approval-requested' | 'approval-responded' | 'input-complete' = 'approval-requested',
) {
  return {
    type: 'tool-call' as const,
    id,
    name: 'runCommand',
    arguments: '{"command":"echo test"}',
    state,
    approval: {
      id: approvalId,
      needsApproval: true,
    },
  }
}

function makeToolResult(toolCallId: string) {
  return {
    type: 'tool-result' as const,
    toolCallId,
    output: { kind: 'text' as const, text: 'ok' },
    state: 'output-available' as const,
  }
}

function makePendingExecutionToolResult(toolCallId: string) {
  return {
    type: 'tool-result' as const,
    toolCallId,
    output: { approved: true, pendingExecution: true },
    state: 'output-available' as const,
  }
}

function makeApprovalToolCallWithPendingOutput(id: string, approvalId: string) {
  return {
    type: 'tool-call' as const,
    id,
    name: 'runCommand',
    arguments: '{"command":"echo test"}',
    state: 'approval-requested' as const,
    approval: {
      id: approvalId,
      needsApproval: true,
    },
    output: '{"kind":"json","data":{"approved":true,"pendingExecution":true}}',
  }
}

function makeApprovalToolCallWithConcreteOutput(id: string, approvalId: string) {
  return {
    type: 'tool-call' as const,
    id,
    name: 'runCommand',
    arguments: '{"command":"echo test"}',
    state: 'approval-requested' as const,
    approval: {
      id: approvalId,
      needsApproval: true,
    },
    output: { approved: false, message: 'Approval required before execution' },
  }
}

describe('findPendingApproval', () => {
  it('returns the newest unresolved approval-requested tool call', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [makeApprovalToolCall('tool-1', 'approval-1'), makeToolResult('tool-1')],
      } as UIMessage,
      {
        id: 'm2',
        role: 'assistant',
        parts: [makeApprovalToolCall('tool-2', 'approval-2')],
      } as UIMessage,
    ]

    const pending = findPendingApproval(messages)

    expect(pending).toEqual({
      toolName: 'runCommand',
      toolArgs: '{"command":"echo test"}',
      approvalId: 'approval-2',
      toolCallId: 'tool-2',
      hasApprovalMetadata: true,
    })
  })

  it('returns null when all approval-requested tool calls already have results', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [makeApprovalToolCall('tool-1', 'approval-1'), makeToolResult('tool-1')],
      } as UIMessage,
    ]

    expect(findPendingApproval(messages)).toBeNull()
  })

  it('keeps approval pending when tool-result is only a pendingExecution marker', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          makeApprovalToolCall('tool-pending', 'approval-pending'),
          makePendingExecutionToolResult('tool-pending'),
        ],
      } as UIMessage,
    ]

    expect(findPendingApproval(messages)).toEqual({
      toolName: 'runCommand',
      toolArgs: '{"command":"echo test"}',
      approvalId: 'approval-pending',
      toolCallId: 'tool-pending',
      hasApprovalMetadata: true,
    })
  })

  it('keeps approval pending when tool-call output is a stringified pendingExecution marker', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          makeApprovalToolCallWithPendingOutput('tool-pending-output', 'approval-pending-output'),
        ],
      } as UIMessage,
    ]

    expect(findPendingApproval(messages)).toEqual({
      toolName: 'runCommand',
      toolArgs: '{"command":"echo test"}',
      approvalId: 'approval-pending-output',
      toolCallId: 'tool-pending-output',
      hasApprovalMetadata: true,
    })
  })

  it('keeps approval pending when call is approval-requested with non-empty output placeholder', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          makeApprovalToolCallWithConcreteOutput('tool-output-placeholder', 'approval-output'),
        ],
      } as UIMessage,
    ]

    expect(findPendingApproval(messages)).toEqual({
      toolName: 'runCommand',
      toolArgs: '{"command":"echo test"}',
      approvalId: 'approval-output',
      toolCallId: 'tool-output-placeholder',
      hasApprovalMetadata: true,
    })
  })

  it('keeps approval pending when approval-requested call also has a non-pending tool-result', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          makeApprovalToolCall('tool-with-result-placeholder', 'approval-with-result'),
          {
            type: 'tool-result',
            toolCallId: 'tool-with-result-placeholder',
            output: { approved: false, message: 'Approval required before execution' },
            state: 'output-available',
          },
        ],
      } as UIMessage,
    ]

    expect(findPendingApproval(messages)).toEqual({
      toolName: 'runCommand',
      toolArgs: '{"command":"echo test"}',
      approvalId: 'approval-with-result',
      toolCallId: 'tool-with-result-placeholder',
      hasApprovalMetadata: true,
    })
  })

  it('detects unresolved approval when tool state regresses to input-complete', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [makeApprovalToolCall('tool-3', 'approval-3', 'input-complete')],
      } as UIMessage,
    ]

    expect(findPendingApproval(messages)).toEqual({
      toolName: 'runCommand',
      toolArgs: '{"command":"echo test"}',
      approvalId: 'approval-3',
      toolCallId: 'tool-3',
      hasApprovalMetadata: true,
    })
  })

  it('falls back to synthetic approval id for unresolved trustable calls without approval metadata', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-4',
            name: 'runCommand',
            arguments: '{"command":"echo test"}',
            state: 'input-complete',
          },
        ],
      } as UIMessage,
    ]

    expect(findPendingApproval(messages)).toEqual({
      toolName: 'runCommand',
      toolArgs: '{"command":"echo test"}',
      approvalId: 'approval_tool-4',
      toolCallId: 'tool-4',
      hasApprovalMetadata: false,
    })
  })

  it('falls back when trustable unresolved call has no explicit state', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-5',
            name: 'runCommand',
            arguments: '{"command":"echo test"}',
          },
        ],
      } as UIMessage,
    ]

    expect(findPendingApproval(messages)).toEqual({
      toolName: 'runCommand',
      toolArgs: '{"command":"echo test"}',
      approvalId: 'approval_tool-5',
      toolCallId: 'tool-5',
      hasApprovalMetadata: false,
    })
  })

  it('ignores trustable unresolved calls with incomplete arguments', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-6',
            name: 'runCommand',
            arguments: '{"command":"echo test"',
          },
        ],
      } as UIMessage,
    ]

    expect(findPendingApproval(messages)).toBeNull()
  })
})
