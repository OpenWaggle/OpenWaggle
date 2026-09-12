import { randomUUID } from 'node:crypto'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type { OpenWaggleMcpServeOptions } from './openwaggle-mcp-server-policy'
import type { OpenWaggleMcpSessionMetadataStore } from './openwaggle-mcp-session-metadata-store'
import {
  hasLiveLease,
  isActiveTaskStatus,
  type OpenWaggleTaskLeaseCoordinator,
  recoverStaleTask,
} from './openwaggle-mcp-task-leases'
import type { OpenWaggleServerTaskServices } from './openwaggle-mcp-task-runtime'
import type { OpenWaggleMcpTaskStore, ServerTaskRecord } from './openwaggle-mcp-task-store'

export interface OpenWaggleTaskStartInput {
  readonly projectPath: string
  readonly objective: string
  readonly sessionId?: string
}

interface OpenWaggleTaskAdmissionOptions {
  readonly input: OpenWaggleTaskStartInput
  readonly leases: OpenWaggleTaskLeaseCoordinator
  readonly options: Pick<OpenWaggleMcpServeOptions, 'originSessionId' | 'profile'>
  readonly services: OpenWaggleServerTaskServices
  readonly sessionMetadata: OpenWaggleMcpSessionMetadataStore
  readonly store: OpenWaggleMcpTaskStore
}

export async function admitOpenWaggleTask(options: OpenWaggleTaskAdmissionOptions) {
  const { input, leases, services, sessionMetadata, store } = options
  if (input.sessionId && input.sessionId === options.options.originSessionId) {
    throw new Error('The caller profile cannot target its own origin session.')
  }
  const [originDepth, targetDepth] = await Promise.all([
    sessionMetadata.depth(options.options.originSessionId),
    sessionMetadata.depth(input.sessionId),
  ])
  const delegationDepth = Math.max(originDepth, targetDepth) + 1
  if (delegationDepth > MCP_CONFIG.MAX_ORCHESTRATION_DEPTH) {
    throw new Error(
      `The task would exceed the maximum hosted session depth of ${MCP_CONFIG.MAX_ORCHESTRATION_DEPTH}.`,
    )
  }
  const executionProfile = await services.resolveExecutionProfile(input.sessionId)
  const now = leases.now()
  const leaseExpiresAt = leases.expiresAt(now)
  const task: ServerTaskRecord = {
    id: randomUUID(),
    callerProfile: options.options.profile,
    projectPath: input.projectPath,
    model: executionProfile.model,
    objective: input.objective,
    delegationDepth,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    lease: { ownerId: leases.ownerId, expiresAt: leaseExpiresAt },
    ...(options.options.originSessionId && !input.sessionId
      ? { parentSessionId: options.options.originSessionId }
      : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  }
  await store.update((tasks) => {
    const reconciled = tasks.map((candidate) =>
      candidate.callerProfile === options.options.profile
        ? recoverStaleTask(candidate, now)
        : candidate,
    )
    const activeTasks = reconciled.filter(
      (candidate) =>
        candidate.callerProfile === options.options.profile &&
        isActiveTaskStatus(candidate.status) &&
        hasLiveLease(candidate, now),
    )
    if (activeTasks.length >= MCP_CONFIG.MAX_SESSION_FAN_OUT) {
      throw new Error(
        `The caller profile already has ${MCP_CONFIG.MAX_SESSION_FAN_OUT} active session tasks. Wait for or interrupt one before starting another.`,
      )
    }
    const targetIsActive = input.sessionId
      ? reconciled.some(
          (candidate) =>
            candidate.sessionId === input.sessionId &&
            isActiveTaskStatus(candidate.status) &&
            hasLiveLease(candidate, now),
        )
      : false
    if (targetIsActive) throw new Error('The target session already has an active hosted task.')
    return { tasks: [task, ...reconciled], result: true }
  })
  return { executionProfile, leaseExpiresAt, task }
}
