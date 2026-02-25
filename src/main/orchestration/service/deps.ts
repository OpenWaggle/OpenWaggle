import { randomUUID } from 'node:crypto'
import { chat, maxIterations } from '@tanstack/ai'
import { isReasoningModel } from '../../agent/quality-config'
import {
  buildPersistedUserMessageParts,
  buildSamplingOptions,
  isResolutionError,
  makeMessage,
  resolveProviderAndQuality,
} from '../../agent/shared'
import { loadProjectConfig } from '../../config/project-config'
import { createLogger } from '../../logger'
import { extractJson, runOpenWaggleOrchestration } from '../engine'
import { createExecutorTools, gatherProjectContext } from '../project-context'
import { orchestrationRunRepository } from '../run-repository'
import type { OrchestrationServiceDeps } from './types'

export const DEFAULT_STREAM_CHUNK_SIZE = 50
export const DEFAULT_STREAM_CHUNK_DELAY_MS = 12

export const defaultOrchestrationServiceDeps: OrchestrationServiceDeps = {
  now: () => Date.now(),
  sleep: async (delayMs) => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs)
    })
  },
  randomId: () => randomUUID(),
  logger: createLogger('orchestration'),
  streamChunkSize: DEFAULT_STREAM_CHUNK_SIZE,
  streamChunkDelayMs: DEFAULT_STREAM_CHUNK_DELAY_MS,
  loadProjectConfig,
  resolveProviderAndQuality,
  isResolutionError,
  isReasoningModel,
  buildPersistedUserMessageParts,
  buildSamplingOptions,
  makeMessage,
  gatherProjectContext,
  createExecutorTools,
  runOpenWaggleOrchestration,
  extractJson,
  chat,
  maxIterations,
  runRepository: orchestrationRunRepository,
}
