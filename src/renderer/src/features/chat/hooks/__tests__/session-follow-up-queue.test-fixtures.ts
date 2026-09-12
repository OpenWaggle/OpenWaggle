import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'

export const SESSION_ID = SessionId('session-1')
export const PAYLOAD: AgentSendPayload = {
  text: 'Run the tests',
  thinkingLevel: 'high',
  attachments: [
    {
      id: 'attachment-1',
      kind: 'text',
      name: 'notes.txt',
      path: '/tmp/notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 4,
      extractedText: 'test',
    },
  ],
}

export function queueResponse() {
  return {
    contractVersion: 2 as const,
    requestId: 'query-1',
    outcome: {
      operation: 'queue-list' as const,
      sessionId: SESSION_ID,
      queueState: 'running' as const,
      queueRevision: 4,
      activeRunId: 'run-1',
      items: [
        {
          followUpId: 'follow-up-1',
          position: 0,
          createdAt: 10,
          deliveryState: 'needs_attention' as const,
          attentionReason: 'authorization_ceiling_changed' as const,
          intent: {
            text: 'Existing follow-up',
            attachmentIds: [],
            runAuthorizationOverride: 'yolo',
            waggle: { presetName: 'Cross-check', source: 'agent' },
          },
        },
      ],
      omittedBodyCount: 0,
    },
  }
}
