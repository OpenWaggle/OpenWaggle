import { z } from 'zod'

import type { OpenHiveOrchestrationPlan, OpenHivePlannedTask } from './types'

const planTaskSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['analysis', 'synthesis', 'repo-edit', 'general']),
  title: z.string().min(1),
  prompt: z.string().min(1),
  dependsOn: z.array(z.string().min(1)).optional(),
  needsConversationContext: z.boolean().optional(),
})

const planSchema = z.object({
  tasks: z.array(planTaskSchema).min(1),
})

export class OpenHivePlanValidationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid orchestration plan: ${issues.join('; ')}`)
    this.name = 'OpenHivePlanValidationError'
    this.issues = issues
  }
}

const VALID_KINDS = new Set(['analysis', 'synthesis', 'repo-edit', 'general'])

/**
 * Extract a JSON object from LLM text output.
 * Handles markdown code fences, preamble text, and trailing commas.
 */
export function extractJson(text: string): unknown {
  let cleaned = text.trim()

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim()
  }

  // Try direct parse
  try {
    return JSON.parse(cleaned) as unknown
  } catch {
    // continue
  }

  // Try to isolate the outermost { ... }
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = cleaned.slice(firstBrace, lastBrace + 1)
    try {
      return JSON.parse(slice) as unknown
    } catch {
      // continue
    }

    // Fix trailing commas before } or ]
    const fixedCommas = slice.replace(/,\s*([}\]])/g, '$1')
    try {
      return JSON.parse(fixedCommas) as unknown
    } catch {
      // continue
    }
  }

  throw new Error('Could not extract valid JSON from text')
}

/**
 * Parse and validate an orchestration plan from raw LLM output.
 *
 * This is lenient by design — it auto-repairs common issues:
 * - Deduplicates task IDs (keeps first occurrence)
 * - Removes invalid or self-referencing dependency references
 * - Coerces unknown task kinds to 'general'
 *
 * Only throws OpenHivePlanValidationError when no valid tasks can be salvaged.
 */
export function parseOpenHivePlan(raw: unknown): OpenHiveOrchestrationPlan {
  const parsed = planSchema.safeParse(raw)
  if (parsed.success) {
    return repairDependencies(parsed.data.tasks)
  }

  // Strict parse failed — try lenient task extraction
  return tryRepairPlan(raw)
}

function tryRepairPlan(raw: unknown): OpenHiveOrchestrationPlan {
  if (!raw || typeof raw !== 'object') {
    throw new OpenHivePlanValidationError(['Plan is not an object'])
  }

  const obj = raw as Record<string, unknown>
  const rawTasks = Array.isArray(obj.tasks) ? obj.tasks : []

  const tasks: OpenHivePlannedTask[] = []
  for (const item of rawTasks) {
    if (!item || typeof item !== 'object') continue
    const t = item as Record<string, unknown>

    const id = typeof t.id === 'string' && t.id.length > 0 ? t.id : null
    const title = typeof t.title === 'string' && t.title.length > 0 ? t.title : null
    const prompt = typeof t.prompt === 'string' && t.prompt.length > 0 ? t.prompt : null
    if (!id || !prompt) continue

    const kind =
      typeof t.kind === 'string' && VALID_KINDS.has(t.kind)
        ? (t.kind as OpenHivePlannedTask['kind'])
        : 'general'

    const dependsOn = Array.isArray(t.dependsOn)
      ? t.dependsOn.filter((d): d is string => typeof d === 'string' && d.length > 0)
      : undefined

    const needsConversationContext =
      typeof t.needsConversationContext === 'boolean' ? t.needsConversationContext : undefined

    tasks.push({ id, kind, title: title ?? id, prompt, dependsOn, needsConversationContext })
  }

  if (tasks.length === 0) {
    throw new OpenHivePlanValidationError(['No valid tasks could be extracted from plan'])
  }

  return repairDependencies(tasks)
}

function repairDependencies(tasks: readonly OpenHivePlannedTask[]): OpenHiveOrchestrationPlan {
  // Deduplicate task IDs — keep first occurrence
  const seen = new Set<string>()
  const deduped: OpenHivePlannedTask[] = []
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
