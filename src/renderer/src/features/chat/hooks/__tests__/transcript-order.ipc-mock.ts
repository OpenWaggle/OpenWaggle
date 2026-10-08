import type { ActiveRunInfo, BackgroundRunSnapshot } from '@shared/types/background-run'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import type { SessionDetail } from '@shared/types/session'
import { vi } from 'vitest'

/*
 * The IPC bridge and chat store the transcript-order harness drives the chat hook through.
 * `transcript-order.test-harness.ts` installs them with `vi.mock`, hoisted above its imports.
 */

type AgentEventPayload = IpcEventChannelMap['agent:event']['payload']
export type RunCompletedPayload = IpcEventChannelMap['agent:run-completed']['payload']

const apiMock = (() => {
  const agentEventHandlers: Array<(payload: AgentEventPayload) => void> = []
  const runCompletedHandlers: Array<(payload: RunCompletedPayload) => void> = []
  const resyncHandlers: Array<() => void> = []
  function subscribe<Handler>(handlers: Handler[]) {
    return (handler: Handler) => {
      handlers.push(handler)
      return () => {
        const index = handlers.indexOf(handler)
        if (index >= 0) handlers.splice(index, 1)
      }
    }
  }
  return {
    agentEventHandlers,
    runCompletedHandlers,
    resyncHandlers,
    onAgentEvent: vi.fn(subscribe(agentEventHandlers)),
    onRunCompleted: vi.fn(subscribe(runCompletedHandlers)),
    onSessionHostResyncRequired: vi.fn(subscribe(resyncHandlers)),
    listActiveRuns: vi.fn(async (): Promise<ActiveRunInfo[]> => []),
    getBackgroundRun: vi.fn(async (_id: string): Promise<BackgroundRunSnapshot | null> => null),
    getSessionDetail: vi.fn(async (_id: string): Promise<SessionDetail | null> => null),
    sendMessage: vi.fn(
      async (
        _id: string,
        _payload: unknown,
        _model: unknown,
      ): Promise<{ readonly outcome: 'delivered'; readonly runId?: string }> => ({
        outcome: 'delivered',
      }),
    ),
    cancelAgent: vi.fn(async () => undefined),
    querySessionControl: vi.fn(
      async (request: {
        readonly requestId: string
        readonly query: { readonly sessionId: string }
      }) => ({
        contractVersion: 2,
        requestId: request.requestId,
        outcome: { operation: 'requests-list', sessionId: request.query.sessionId, requests: [] },
      }),
    ),
  }
})()

const chatStoreMock = {
  refreshSession: vi.fn(async (_sessionId: string) => {}),
  upsertSession: vi.fn((_session: SessionDetail) => {}),
}

export const transcriptOrderApiMock = apiMock
export const transcriptOrderChatStoreMock = chatStoreMock

export function useTranscriptOrderChatStore(selector: (state: typeof chatStoreMock) => unknown) {
  return selector(chatStoreMock)
}
