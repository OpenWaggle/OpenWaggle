import { Schema } from '@shared/schema'
import { handleShutdownResponse, sendAgentMessage } from '../../sub-agents/facade'
import { defineOpenWaggleTool } from '../define-tool'

export const sendMessageTool = defineOpenWaggleTool({
  name: 'sendMessage',
  description:
    'Send a message to another agent in the team. Supports direct messages, broadcasts, shutdown requests/responses, and plan approval responses.',
  needsApproval: false,
  inputSchema: Schema.Struct({
    type: Schema.Literal(
      'message',
      'broadcast',
      'shutdown_request',
      'shutdown_response',
      'plan_approval_response',
    ).annotations({ description: 'Message type' }),
    recipient: Schema.optional(
      Schema.String.annotations({
        description:
          'Agent name to send to (required for message, shutdown_request, plan_approval_response)',
      }),
    ),
    content: Schema.optional(
      Schema.String.annotations({ description: 'Message text or feedback' }),
    ),
    summary: Schema.optional(
      Schema.String.annotations({
        description: '5-10 word summary for UI preview (required for message, broadcast)',
      }),
    ),
    requestId: Schema.optional(
      Schema.String.annotations({
        description: 'Request ID to respond to (for shutdown_response, plan_approval_response)',
      }),
    ),
    approve: Schema.optional(
      Schema.Boolean.annotations({
        description:
          'Whether to approve the request (for shutdown_response, plan_approval_response)',
      }),
    ),
  }),
  async execute(args, context) {
    const senderName = context.subAgentContext?.agentName ?? 'main-agent'

    // Handle shutdown response separately
    if (args.type === 'shutdown_response' && args.requestId) {
      handleShutdownResponse(args.requestId, args.approve ?? false, args.content)
      return {
        kind: 'json',
        data: {
          type: 'shutdown_response',
          requestId: args.requestId,
          approved: args.approve ?? false,
        },
      }
    }

    // Validate required fields
    if (
      (args.type === 'message' ||
        args.type === 'shutdown_request' ||
        args.type === 'plan_approval_response') &&
      !args.recipient
    ) {
      return {
        kind: 'json',
        data: { ok: false, error: `"recipient" is required for ${args.type}` },
      }
    }

    const messageId = sendAgentMessage({
      type: args.type,
      sender: senderName,
      recipient: args.recipient,
      content: args.content ?? '',
      summary: args.summary,
      requestId: args.requestId,
      approve: args.approve,
    })

    return {
      kind: 'json',
      data: {
        sent: true,
        type: args.type,
        recipient: args.recipient ?? 'all',
        messageId,
      },
    }
  },
})
