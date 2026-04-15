import { DOUBLE_FACTOR } from '@shared/constants/math'
import type { MutableTask } from './engine-state'
import type { OrchestrationTaskDefinition, OrchestrationTaskRetryPolicy } from './types'

export function normalizeRetryPolicy(
  retry: OrchestrationTaskRetryPolicy | undefined,
): Required<OrchestrationTaskRetryPolicy> {
  return {
    retries: Math.max(0, Math.floor(retry?.retries ?? 0)),
    backoffMs: Math.max(0, Math.floor(retry?.backoffMs ?? 0)),
    jitterMs: Math.max(0, Math.floor(retry?.jitterMs ?? 0)),
  }
}

export function normalizeTimeout(timeoutMs: number | undefined): number | undefined {
  if (typeof timeoutMs !== 'number') {
    return undefined
  }
  const normalized = Math.max(1, Math.floor(timeoutMs))
  return normalized
}

export function shouldRetry(
  policy: Required<OrchestrationTaskRetryPolicy>,
  attemptNumber: number,
): boolean {
  return attemptNumber <= policy.retries
}

export function retryDelayMs(
  policy: Required<OrchestrationTaskRetryPolicy>,
  attemptNumber: number,
  random: () => number,
): number {
  const backoff =
    policy.backoffMs > 0 ? policy.backoffMs * DOUBLE_FACTOR ** Math.max(0, attemptNumber - 1) : 0
  const jitter = policy.jitterMs > 0 ? random() * policy.jitterMs : 0
  return Math.max(0, Math.floor(backoff + jitter))
}

export function taskToDefinition(task: MutableTask): OrchestrationTaskDefinition {
  return {
    id: task.id,
    kind: task.kind,
    input: task.input,
    dependsOn: task.dependsOn,
    retry: task.retry,
    timeoutMs: task.timeoutMs,
    metadata: task.metadata,
  }
}

export function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export async function defaultSleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs)
  })
}
