/**
 * Centralized Zod schemas for runtime boundary validation.
 *
 * Schemas here replace `as T` casts at JSON.parse, IPC, and external API
 * boundaries. Consumers import from this module instead of defining
 * inline schemas.
 *
 * Uses Zod v4 API — `.loose()` instead of deprecated `.passthrough()`.
 */
import {
  ORCHESTRATION_RUN_STATUSES,
  ORCHESTRATION_TASK_STATUSES,
} from '@shared/types/orchestration'
import { z } from 'zod'

// ─── Generic record ─────────────────────────────────────────────────
/** Validates any JSON object — replaces `JSON.parse(...) as Record<string, unknown>`. */
export const unknownRecordSchema = z.record(z.string(), z.unknown())

// ─── Orchestration ──────────────────────────────────────────────────
/** Task tool progress event from orchestration executors. */
export const taskToolProgressSchema = z.object({
  type: z.enum(['tool_start', 'tool_end']),
  toolName: z.string(),
  toolCallId: z.string(),
  toolInput: unknownRecordSchema.optional(),
})

/** Persisted run index shape. */
export const persistedRunIndexSchema = z.object({
  ids: z.array(z.string()),
})

/** Validates a persisted OrchestrationTaskAttempt. */
export const orchestrationTaskAttemptSchema = z.object({
  attempt: z.number(),
  status: z.enum(['ok', 'error', 'cancelled']),
  errorCode: z.string().optional(),
  error: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: z.number(),
})

/** Validates a persisted OrchestrationTaskRetryPolicy. */
export const orchestrationTaskRetryPolicySchema = z.object({
  retries: z.number(),
  backoffMs: z.number(),
  jitterMs: z.number(),
})

/** Validates a persisted OrchestrationTaskRecord (strings, not branded types). */
export const orchestrationTaskRecordSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    status: z.enum(ORCHESTRATION_TASK_STATUSES),
    dependsOn: z.array(z.string()),
    title: z.string().optional(),
    startedAt: z.string().optional(),
    finishedAt: z.string().optional(),
    errorCode: z.string().optional(),
    error: z.string().optional(),
    retry: orchestrationTaskRetryPolicySchema.optional(),
    attempts: z.array(orchestrationTaskAttemptSchema).optional(),
    createdOrder: z.number().optional(),
  })
  .loose()

/**
 * Structural shape of a persisted OrchestrationRunRecord.
 * Validates JSON structure; branded types are applied by the repository layer.
 */
export const orchestrationRunRecordSchema = z
  .object({
    runId: z.string(),
    conversationId: z.string(),
    status: z.enum(ORCHESTRATION_RUN_STATUSES),
    startedAt: z.string(),
    finishedAt: z.string().optional(),
    taskOrder: z.array(z.string()),
    tasks: z.record(z.string(), orchestrationTaskRecordSchema),
    outputs: z.record(z.string(), z.unknown()),
    fallbackUsed: z.boolean(),
    fallbackReason: z.string().optional(),
    updatedAt: z.number(),
  })
  .loose()

// ─── Planner ────────────────────────────────────────────────────────
export const plannedTaskSchema = z
  .object({
    id: z.string(),
    kind: z.string().optional(),
    title: z.string().optional(),
    narration: z.string().optional(),
    description: z.string().optional(),
    dependsOn: z.array(z.string()).optional(),
  })
  .loose()

// ─── Package.json ───────────────────────────────────────────────────
export const packageJsonSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
    scripts: z.record(z.string(), z.string()).optional(),
  })
  .loose()

// ─── Project config (TOML) ─────────────────────────────────────────
/**
 * Quality tier fields use `.catch(undefined)` so that non-numeric TOML
 * values (e.g. `temperature = "not a number"`) gracefully degrade to
 * `undefined` instead of failing the entire config parse.
 */
export const qualityTierSchema = z
  .object({
    temperature: z.number().optional().catch(undefined),
    top_p: z.number().optional().catch(undefined),
    max_tokens: z.number().optional().catch(undefined),
  })
  .loose()

export const projectConfigSchema = z
  .object({
    quality: z
      .object({
        low: qualityTierSchema.optional(),
        medium: qualityTierSchema.optional(),
        high: qualityTierSchema.optional(),
      })
      .optional(),
  })
  .loose()

// ─── Ollama API ─────────────────────────────────────────────────────
export const ollamaTagsResponseSchema = z.object({
  models: z.array(z.object({ name: z.string() })).optional(),
})

// ─── Electron File ──────────────────────────────────────────────────
/** Electron adds `.path` to File objects — validates that field exists. */
export const electronFileSchema = z.object({ path: z.string() }).loose()
