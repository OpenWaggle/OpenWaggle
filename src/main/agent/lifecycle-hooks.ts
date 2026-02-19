import type { StreamChunk } from '@tanstack/ai'
import type {
  AgentLifecycleHook,
  AgentRunContext,
  AgentRunSummary,
  AgentToolCallEndEvent,
  AgentToolCallStartEvent,
} from './runtime-types'

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
      console.warn(
        '[agent-hook]',
        JSON.stringify({
          event: 'hook-error',
          runId: context.runId,
          hookId: hook.id,
          hookEvent: eventName,
          message: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }
}

export async function notifyRunStart(
  hooks: readonly AgentLifecycleHook[],
  context: AgentRunContext,
): Promise<void> {
  await runHookEvent(hooks, context, 'onRunStart', (hook) => hook.onRunStart?.(context))
}

export async function notifyStreamChunk(
  hooks: readonly AgentLifecycleHook[],
  context: AgentRunContext,
  chunk: StreamChunk,
): Promise<void> {
  await runHookEvent(hooks, context, 'onStreamChunk', (hook) =>
    hook.onStreamChunk?.(context, chunk),
  )
}

export async function notifyToolCallStart(
  hooks: readonly AgentLifecycleHook[],
  context: AgentRunContext,
  event: AgentToolCallStartEvent,
): Promise<void> {
  await runHookEvent(hooks, context, 'onToolCallStart', (hook) =>
    hook.onToolCallStart?.(context, event),
  )
}

export async function notifyToolCallEnd(
  hooks: readonly AgentLifecycleHook[],
  context: AgentRunContext,
  event: AgentToolCallEndEvent,
): Promise<void> {
  await runHookEvent(hooks, context, 'onToolCallEnd', (hook) =>
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
