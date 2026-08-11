import type { McpTurnSnapshot } from '@shared/types/mcp'
import {
  beginMcpTurn,
  clearMcpTurnApplications,
  completeMcpTurn,
  isMcpTurnActive,
} from '../../../domain/mcp/turn-application-state'
import type { McpRuntimeInteractions } from '../../../ports/mcp-runtime-service'
import { callMcpAppTool } from './app-tool-caller'
import {
  browseMcpCapabilities,
  getMcpPrompt,
  operateMcpTask,
  readMcpResource,
} from './capability-browser'
import { listMcpDirectTools } from './direct-tools'
import { executeMcpGateway } from './gateway-executor'
import { reviewMcpRemoteSkill } from './remote-skills'
import type { McpRemoteTaskStore } from './remote-task-store'
import { runMcpRuntimeDoctor } from './runtime-doctor'
import { McpRuntimeState } from './runtime-state'
import type { McpConnectionFactory } from './types'

export function createMcpRuntimeService(input: {
  readonly connect: McpConnectionFactory
  readonly createHandleKey?: () => Buffer
  readonly now?: () => number
  readonly remoteTaskStore?: McpRemoteTaskStore
}) {
  const state = new McpRuntimeState(input.connect, input)
  return {
    prepareTurn: async (turn: {
      readonly sessionId: string
      readonly snapshot: McpTurnSnapshot | null
    }) => {
      beginMcpTurn(turn.sessionId, turn.snapshot?.revision ?? null)
      try {
        if (!turn.snapshot) return await state.disposeSession(turn.sessionId)
        await state.discardSupersededSessionConnections(turn.snapshot)
      } catch (error) {
        completeMcpTurn(turn.sessionId)
        await state.disposeSession(turn.sessionId).catch(() => undefined)
        throw error
      }
    },
    completeTurn: async (turn: {
      readonly sessionId: string
      readonly nextSnapshot: McpTurnSnapshot | null
    }) => {
      completeMcpTurn(turn.sessionId)
      if (!turn.nextSnapshot) return state.disposeSession(turn.sessionId)
      await state.discardSupersededSessionConnections(turn.nextSnapshot)
    },
    executeGateway: (
      snapshot: McpTurnSnapshot,
      request: Parameters<typeof executeMcpGateway>[2],
      signal?: AbortSignal,
      interactions?: McpRuntimeInteractions,
    ) => executeMcpGateway(state, snapshot, request, signal, interactions),
    listDirectTools: (snapshot: McpTurnSnapshot) => listMcpDirectTools(state, snapshot),
    browseCapabilities: (snapshot: McpTurnSnapshot, serverInstanceId?: string) =>
      browseMcpCapabilities(state, snapshot, serverInstanceId),
    getPrompt: (request: Omit<Parameters<typeof getMcpPrompt>[0], 'state'>) =>
      getMcpPrompt({ ...request, state }),
    readResource: (request: Omit<Parameters<typeof readMcpResource>[0], 'state'>) =>
      readMcpResource({ ...request, state }),
    reviewRemoteSkill: (request: Omit<Parameters<typeof reviewMcpRemoteSkill>[0], 'state'>) =>
      reviewMcpRemoteSkill({ ...request, state }),
    callAppTool: (request: Omit<Parameters<typeof callMcpAppTool>[0], 'state'>) =>
      callMcpAppTool({ ...request, state }),
    operateTask: (
      snapshot: McpTurnSnapshot | null,
      request: Parameters<typeof operateMcpTask>[2],
    ) => operateMcpTask(state, snapshot, request),
    setEventSubscription: (request: {
      readonly snapshot: McpTurnSnapshot
      readonly serverInstanceId: string
      readonly enabled: boolean
      readonly resourceUris: readonly string[]
    }) => state.setEventSubscription(request),
    getEvents: async (sessionId?: string | null) => state.getEvents(sessionId),
    getEventSubscriptions: async (sessionId?: string | null) =>
      state.getEventSubscriptions(sessionId),
    disposeSession: (sessionId: string) => {
      completeMcpTurn(sessionId)
      return state.disposeSession(sessionId)
    },
    reconcileIdleConnections: () => state.reconcileIdleConnections(isMcpTurnActive),
    disposeAll: () => {
      clearMcpTurnApplications()
      return state.disposeAll()
    },
    getConnectionStatuses: async () => state.getConnectionStatuses(),
    getNotices: async (sessionId?: string | null) => state.getNotices(sessionId),
    doctor: runMcpRuntimeDoctor,
  }
}
