import { useAgentLoopEventStore } from '../../state/agent-loop-event-store'
import { useBackgroundRunStore } from '../../state/background-run-store'
import { resetLiveStreamMessages } from '../../state/live-stream-message-store'
import { useOptimisticSteerStore } from '../../state/optimistic-steer-store'
import { useOptimisticUserMessageStore } from '../../state/optimistic-user-message-store'
import { useRunFinishingStore } from '../../state/run-finishing-store'
import { transcriptOrderApiMock as apiMock } from './transcript-order.ipc-mock'
import { SESSION_ID } from './transcript-order.persisted'

/** The renderer's stores and bridge subscriptions as a fresh window has them. */
export function resetRendererState() {
  apiMock.agentEventHandlers.length = 0
  apiMock.runCompletedHandlers.length = 0
  apiMock.resyncHandlers.length = 0
  useBackgroundRunStore.setState({
    activeRunIds: new Set(),
    runModelBySessionId: new Map(),
    renderSnapshotsBySessionId: new Map(),
    worktreeLaunchBySessionId: new Map(),
    firstSendRecoveryBySessionId: new Map(),
  })
  useAgentLoopEventStore.setState({ sessionsById: new Map() })
  useOptimisticUserMessageStore.setState({ messagesBySessionId: new Map() })
  useOptimisticSteerStore.setState({ previews: new Map(), runIds: new Map() })
  useRunFinishingStore.getState().clear(SESSION_ID)
  resetLiveStreamMessages()
}
