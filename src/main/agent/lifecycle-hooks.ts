import type { StreamChunk } from '@tanstack/ai'
import { createLogger } from '../logger'
import type {
  AgentLifecycleHook,
  AgentRunContext,
  AgentRunSummary,
  AgentToolCallEndEvent,
  AgentToolCallStartEvent,
} from './runtime-types'

const logger = createLogger('agent-hook')

type HookCall = (hook: AgentLifecycleHook) => void | Promise<void>

async function runHookEvent(
  hooks: readonly AgentLifecycleHook[],
  context: AgentRunContext,
  eventName: string,
  invoke: HookCall,
): Promise<void> {
  for (const hook of hooks) {
    try {
      await invoke(hook)
    } catch (error) {
      logger.warn('hook-error', {
        runId: context.runId,
        hookId: hook.id,
        hookEvent: eventName,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

function runHookEventDetached(
  hooks: readonly AgentLifecycleHook[],
  context: AgentRunContext,
  eventName: string,
  invoke: HookCall,
): void {
  void runHookEvent(hooks, context, eventName, invoke).catch((error) => {
    logger.warn('hook-dispatch-error', {
      runId: context.runId,
      hookEvent: eventName,
      message: error instanceof Error ? error.message : String(error),
    })
  })
}

export async function notifyRunStart(
  hooks: readonly AgentLifecycleHook[],
  context: AgentRunContext,
): Promise<void> {
  await runHookEvent(hooks, context, 'onRunStart', (hook) => hook.onRunStart?.(context))
}

export function notifyStreamChunk(
  hooks: readonly AgentLifecycleHook[],
  context: AgentRunContext,
  chunk: StreamChunk,
): void {
  runHookEventDetached(hooks, context, 'onStreamChunk', (hook) =>
    hook.onStreamChunk?.(context, chunk),
  )
}

export function notifyToolCallStart(
  hooks: readonly AgentLifecycleHook[],
  context: AgentRunContext,
  event: AgentToolCallStartEvent,
): void {
  runHookEventDetached(hooks, context, 'onToolCallStart', (hook) =>
    hook.onToolCallStart?.(context, event),
  )
}

export function notifyToolCallEnd(
  hooks: readonly AgentLifecycleHook[],
  context: AgentRunContext,
  event: AgentToolCallEndEvent,
): void {
  runHookEventDetached(hooks, context, 'onToolCallEnd', (hook) =>
    hook.onToolCallEnd?.(context, event),
  )
}

export async function notifyRunError(
  hooks: readonly AgentLifecycleHook[],
  context: AgentRunContext,
  error: Error,
): Promise<void> {
  await runHookEvent(hooks, context, 'onRunError', (hook) => hook.onRunError?.(context, error))
}

export async function notifyRunComplete(
  hooks: readonly AgentLifecycleHook[],
  context: AgentRunContext,
  summary: AgentRunSummary,
): Promise<void> {
  await runHookEvent(hooks, context, 'onRunComplete', (hook) =>
    hook.onRunComplete?.(context, summary),
  )
}
