import { ConversationId, MessageId, ToolCallId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { UIMessage } from '@tanstack/ai-react'
import { describe, expect, it } from 'vitest'
import { findPendingApproval } from '../pending-tool-interactions'

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

function makeDeniedApprovalToolCall(id: string, approvalId: string) {
  return {
    type: 'tool-call' as const,
    id,
    name: 'runCommand',
    arguments: '{"command":"echo test"}',
    state: 'approval-responded' as const,
    approval: {
      id: approvalId,
      needsApproval: true,
      approved: false,
    },
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

  it('keeps approval pending after approval-responded until a concrete execution result exists', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          makeApprovalToolCall(
            'tool-responded-pending',
            'approval-responded-pending',
            'approval-responded',
          ),
          makePendingExecutionToolResult('tool-responded-pending'),
        ],
      } as UIMessage,
    ]

    expect(findPendingApproval(messages)).toEqual({
      toolName: 'runCommand',
      toolArgs: '{"command":"echo test"}',
      approvalId: 'approval-responded-pending',
      toolCallId: 'tool-responded-pending',
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

  it('does not keep approval pending when call output records a denied approval', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          makeApprovalToolCallWithConcreteOutput('tool-output-placeholder', 'approval-output'),
        ],
      } as UIMessage,
    ]

    expect(findPendingApproval(messages)).toBeNull()
  })

  it('does not keep approval pending when a denied approval tool-result exists', () => {
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

    expect(findPendingApproval(messages)).toBeNull()
  })

  it('does not keep approval pending when approval metadata records an explicit denial', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [makeDeniedApprovalToolCall('tool-denied', 'approval-denied')],
      } as UIMessage,
    ]

    expect(findPendingApproval(messages)).toBeNull()
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

  it('recovers persisted approval metadata when hydrated UI parts drop approval fields', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-persisted-shadow',
            name: 'writeFile',
            arguments: '{"path":"pending.txt"}',
            state: 'input-complete',
          },
        ],
      } as UIMessage,
    ]
    const persistedConversation: Conversation = {
      id: ConversationId('conv-1'),
      title: 'Pending approval',
      projectPath: null,
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: MessageId('msg-1'),
          role: 'assistant',
          createdAt: 1,
          parts: [
            {
              type: 'tool-call',
              toolCall: {
                id: ToolCallId('tool-persisted'),
                name: 'writeFile',
                args: { path: 'pending.txt' },
                state: 'approval-requested',
                approval: {
                  id: 'approval_tool-persisted',
                  needsApproval: true,
                },
              },
            },
          ],
        },
      ],
    }

    expect(findPendingApproval(messages, persistedConversation)).toEqual({
      toolName: 'writeFile',
      toolArgs: '{"path":"pending.txt"}',
      approvalId: 'approval_tool-persisted',
      toolCallId: 'tool-persisted-shadow',
      hasApprovalMetadata: true,
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

  it('skips approved tool and shows next unapproved tool in multi-approval batch', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          // writeFile: still waiting for approval decision
          makeApprovalToolCall('tool-write', 'approval-write', 'approval-requested'),
          // editFile: user already approved, waiting for execution
          {
            type: 'tool-call' as const,
            id: 'tool-edit',
            name: 'editFile',
            arguments: '{"path":"README.md"}',
            state: 'approval-responded' as const,
            approval: {
              id: 'approval-edit',
              needsApproval: true,
              approved: true,
            },
          },
        ],
      } as UIMessage,
    ]

    const pending = findPendingApproval(messages)

    // Should return writeFile (still needs decision), NOT editFile (already approved)
    expect(pending).toEqual({
      toolName: 'runCommand',
      toolArgs: '{"command":"echo test"}',
      approvalId: 'approval-write',
      toolCallId: 'tool-write',
      hasApprovalMetadata: true,
    })
  })

  it('returns null when all tools in batch are approved and awaiting execution', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call' as const,
            id: 'tool-write',
            name: 'writeFile',
            arguments: '{"path":"test.txt"}',
            state: 'approval-responded' as const,
            approval: { id: 'approval-write', needsApproval: true, approved: true },
          },
          {
            type: 'tool-call' as const,
            id: 'tool-edit',
            name: 'editFile',
            arguments: '{"path":"README.md"}',
            state: 'approval-responded' as const,
            approval: { id: 'approval-edit', needsApproval: true, approved: true },
          },
        ],
      } as UIMessage,
    ]

    // Both approved — no pending approval banner needed
    expect(findPendingApproval(messages)).toBeNull()
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
