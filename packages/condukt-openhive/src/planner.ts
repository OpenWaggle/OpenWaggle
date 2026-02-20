import { z } from 'zod'

import type { OpenHiveOrchestrationPlan } from './types'

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

export function parseOpenHivePlan(raw: unknown): OpenHiveOrchestrationPlan {
  const parsed = planSchema.safeParse(raw)
  if (!parsed.success) {
    throw new OpenHivePlanValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`),
    )
  }

  const taskIds = new Set<string>()
  for (const task of parsed.data.tasks) {
    if (taskIds.has(task.id)) {
      throw new OpenHivePlanValidationError([`Duplicate task id: ${task.id}`])
    }
    taskIds.add(task.id)
  }

  for (const task of parsed.data.tasks) {
    for (const dependencyId of task.dependsOn ?? []) {
      if (!taskIds.has(dependencyId)) {
        throw new OpenHivePlanValidationError([
          `Task ${task.id} depends on missing task ${dependencyId}`,
        ])
      }
    }
  }

  return parsed.data
}
