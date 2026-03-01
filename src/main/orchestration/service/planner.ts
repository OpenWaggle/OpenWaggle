import { plannedTaskSchema } from '@shared/schemas/validation'
import type { JsonValue } from '@shared/types/json'
import { z } from 'zod'

const directPlanResultSchema = z.object({
  direct: z.literal(true),
  response: z.string(),
})

const taskPlanResultSchema = z.object({
  ackText: z.string().optional(),
  tasks: z.array(plannedTaskSchema),
})

export type PlannedTask = z.infer<typeof plannedTaskSchema>

export type PlannerDecision =
  | {
      readonly kind: 'direct'
      readonly response: string
    }
  | {
      readonly kind: 'tasks'
      readonly ackText: string | null
      readonly tasks: readonly PlannedTask[]
    }

export function parsePlannerDecision(value: JsonValue): PlannerDecision {
  const direct = directPlanResultSchema.safeParse(value)
  if (direct.success) {
    return { kind: 'direct', response: direct.data.response }
  }

  const taskPlan = taskPlanResultSchema.safeParse(value)
  if (taskPlan.success) {
    return {
      kind: 'tasks',
      ackText: taskPlan.data.ackText ?? null,
      tasks: taskPlan.data.tasks,
    }
  }

  return {
    kind: 'tasks',
    ackText: null,
    tasks: [],
  }
}

export function getPlanTaskCount(value: JsonValue): number {
  const result = taskPlanResultSchema.safeParse(value)
  return result.success ? result.data.tasks.length : 0
}
