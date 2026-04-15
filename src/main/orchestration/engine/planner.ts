import { ORCHESTRATION } from '@shared/constants/agent-config'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import type { JsonValue } from '@shared/types/json'

import type { OpenWaggleOrchestrationPlan, OpenWagglePlannedTask } from './types'

export const MAX_PLAN_TASKS = ORCHESTRATION.MAX_PLAN_TASKS

const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))

const planTaskSchema = Schema.Struct({
  id: nonEmptyStringSchema,
  kind: Schema.Literal('analysis', 'synthesis', 'repo-edit', 'general'),
  title: nonEmptyStringSchema,
  prompt: nonEmptyStringSchema,
  dependsOn: Schema.optional(Schema.Array(nonEmptyStringSchema)),
  needsConversationContext: Schema.optional(Schema.Boolean),
})

const planSchema = Schema.Struct({
  tasks: Schema.Array(planTaskSchema).pipe(Schema.minItems(1), Schema.maxItems(MAX_PLAN_TASKS)),
})

export class OpenWagglePlanValidationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid orchestration plan: ${issues.join('; ')}`)
    this.name = 'OpenWagglePlanValidationError'
    this.issues = issues
  }
}

const VALID_KINDS: ReadonlySet<string> = new Set(['analysis', 'synthesis', 'repo-edit', 'general'])

function isValidTaskKind(value: string): value is OpenWagglePlannedTask['kind'] {
  return VALID_KINDS.has(value)
}

/**
 * Parse and validate an orchestration plan from raw LLM output.
 *
 * This is lenient by design — it auto-repairs common issues:
 * - Deduplicates task IDs (keeps first occurrence)
 * - Removes invalid or self-referencing dependency references
 * - Coerces unknown task kinds to 'general'
 *
 * Only throws OpenWagglePlanValidationError when no valid tasks can be salvaged.
 */
export function parseOpenWagglePlan(raw: JsonValue): OpenWaggleOrchestrationPlan {
  const parsed = safeDecodeUnknown(planSchema, raw)
  if (parsed.success) {
    return repairDependencies(parsed.data.tasks)
  }

  // Strict parse failed — try lenient task extraction
  return tryRepairPlan(raw)
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tryRepairPlan(raw: JsonValue): OpenWaggleOrchestrationPlan {
  if (!isRecord(raw)) {
    throw new OpenWagglePlanValidationError(['Plan is not an object'])
  }

  const rawTasks = Array.isArray(raw.tasks) ? raw.tasks : []

  const tasks: OpenWagglePlannedTask[] = []
  for (const item of rawTasks) {
    if (!isRecord(item)) continue

    const id = typeof item.id === 'string' && item.id.length > 0 ? item.id : null
    const title = typeof item.title === 'string' && item.title.length > 0 ? item.title : null
    const prompt = typeof item.prompt === 'string' && item.prompt.length > 0 ? item.prompt : null
    if (!id || !prompt) continue

    const kind = typeof item.kind === 'string' && isValidTaskKind(item.kind) ? item.kind : 'general'

    const dependsOn = Array.isArray(item.dependsOn)
      ? item.dependsOn.filter((d): d is string => typeof d === 'string' && d.length > 0)
      : undefined

    const needsConversationContext =
      typeof item.needsConversationContext === 'boolean' ? item.needsConversationContext : undefined

    const narration =
      typeof item.narration === 'string' && item.narration.length > 0 ? item.narration : undefined

    tasks.push({
      id,
      kind,
      title: title ?? id,
      prompt,
      narration,
      dependsOn,
      needsConversationContext,
    })
  }

  if (tasks.length === 0) {
    throw new OpenWagglePlanValidationError(['No valid tasks could be extracted from plan'])
  }

  // Enforce max task count
  if (tasks.length > MAX_PLAN_TASKS) {
    tasks.splice(MAX_PLAN_TASKS)
  }

  return repairDependencies(tasks)
}

function repairDependencies(tasks: readonly OpenWagglePlannedTask[]): OpenWaggleOrchestrationPlan {
  // Deduplicate task IDs — keep first occurrence
  const seen = new Set<string>()
  const deduped: OpenWagglePlannedTask[] = []
  for (const task of tasks) {
    if (!seen.has(task.id)) {
      seen.add(task.id)
      deduped.push(task)
    }
  }

  // Remove invalid or self-referencing dependency references
  const validIds = new Set(deduped.map((t) => t.id))
  const repaired = deduped.map((task) => ({
    ...task,
    dependsOn: (task.dependsOn ?? []).filter((dep) => validIds.has(dep) && dep !== task.id),
  }))

  return { tasks: repaired }
}
