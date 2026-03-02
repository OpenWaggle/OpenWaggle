import { z } from 'zod'
import { handleShutdownResponse, sendAgentMessage } from '../../sub-agents/facade'
import { defineOpenWaggleTool } from '../define-tool'

export const sendMessageTool = defineOpenWaggleTool({
  name: 'sendMessage',
  description:
    'Send a message to another agent in the team. Supports direct messages, broadcasts, shutdown requests/responses, and plan approval responses.',
  needsApproval: false,
  inputSchema: z.object({
    type: z
      .enum([
        'message',
        'broadcast',
        'shutdown_request',
        'shutdown_response',
        'plan_approval_response',
      ])
      .describe('Message type'),
    recipient: z
      .string()
      .optional()
      .describe(
        'Agent name to send to (required for message, shutdown_request, plan_approval_response)',
      ),
    content: z.string().optional().describe('Message text or feedback'),
    summary: z
      .string()
      .optional()
      .describe('5-10 word summary for UI preview (required for message, broadcast)'),
    requestId: z
      .string()
      .optional()
      .describe('Request ID to respond to (for shutdown_response, plan_approval_response)'),
    approve: z
      .boolean()
      .optional()
      .describe('Whether to approve the request (for shutdown_response, plan_approval_response)'),
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
