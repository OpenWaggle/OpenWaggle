import { Schema, safeDecodeUnknown } from '@shared/schema'
import { plannedTaskSchema } from '@shared/schemas/validation'
import type { JsonValue } from '@shared/types/json'

const directPlanResultSchema = Schema.Struct({
  direct: Schema.Literal(true),
  response: Schema.String,
})

const taskPlanResultSchema = Schema.Struct({
  ackText: Schema.optional(Schema.String),
  tasks: Schema.mutable(Schema.Array(plannedTaskSchema)),
})

export type PlannedTask = Schema.Schema.Type<typeof plannedTaskSchema>

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
  const direct = safeDecodeUnknown(directPlanResultSchema, value)
  if (direct.success) {
    return { kind: 'direct', response: direct.data.response }
  }

  const taskPlan = safeDecodeUnknown(taskPlanResultSchema, value)
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
