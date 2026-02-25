import { plannedTaskSchema } from '@shared/schemas/validation'
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

export function parsePlannerDecision(value: unknown): PlannerDecision {
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

export function getPlanTaskCount(value: unknown): number {
  const result = taskPlanResultSchema.safeParse(value)
  return result.success ? result.data.tasks.length : 0
}

const WEB_INTENT_KEYWORDS = [
  'go to',
  'visit',
  'look up',
  'check out',
  'browse',
  'fetch',
  'open the',
  'read the docs',
  'official site',
  'official docs',
  'official documentation',
  'official page',
]

const WEB_INTENT_TOKEN_PATTERNS = [
  'docs',
  'documentation',
  'website',
  'webpage',
  'web page',
  'url',
  'homepage',
].map((token) => new RegExp(`\\b${token}\\b`, 'i'))

const URL_PATTERN = /https?:\/\/\S+/i

export function hasWebIntent(text: string): boolean {
  if (URL_PATTERN.test(text)) return true
  const lower = text.toLowerCase()
  for (const phrase of WEB_INTENT_KEYWORDS) {
    if (lower.includes(phrase)) return true
  }
  for (const pattern of WEB_INTENT_TOKEN_PATTERNS) {
    if (pattern.test(lower)) return true
  }
  return false
}

const TASK_FORMAT_LINES = [
  'Task response format:',
  '{"ackText":"<brief 1-sentence acknowledgment>","tasks":[{"id":"string","kind":"analysis|debugging|refactoring|testing|documentation|repo-edit|synthesis|general","title":"string","prompt":"string","narration":"<short natural-language intro for this task, e.g. Let me read the core documentation...>","dependsOn":["id"],"needsConversationContext":boolean}]}',
  '',
  'Task constraints:',
  '- 2 to 5 tasks (analysis or general work — do NOT include a synthesis task)',
  '- id must be stable kebab-case',
  '- Each task MUST have a narration — a brief, natural sentence the agent says before starting the task',
  '- dependsOn optional and must reference prior tasks',
  '- The system will automatically synthesize task results — do NOT create a synthesis/summary task',
  '- DO NOT answer the user request yourself — let the task executors do the work',
]

export function buildPlannerPrompt(
  projectContextText: string,
  userText: string,
  forceTaskDecomposition: boolean,
): string {
  const lines: string[] = []

  if (projectContextText) {
    lines.push(projectContextText, '')
  }
  lines.push(`User request: ${userText}`, '')

  if (forceTaskDecomposition) {
    lines.push(
      'You are a task planner. The user explicitly needs web-derived information.',
      'Return strict JSON only (no markdown, code fences, or prose).',
      '',
      'Task executors can use readFile, glob, and webFetch.',
      'You MUST decompose into tasks, and at least one task MUST fetch web content via webFetch.',
      'Do not answer from prior knowledge alone.',
      '',
      ...TASK_FORMAT_LINES,
    )
  } else {
    lines.push(
      'You are a task planner. Choose between direct response and task decomposition.',
      'Return strict JSON only (no markdown, code fences, or prose).',
      '',
      'Task executors can use readFile, glob, and webFetch.',
      '',
      'Use direct response ONLY for pure knowledge questions with no project/file/web dependency.',
      'Direct response format:',
      '{"direct":true,"response":"your answer"}',
      '',
      'For project work (analysis/debugging/code review/changes) ALWAYS decompose into tasks.',
      'For any web-content request (docs/websites/APIs) ALWAYS decompose into tasks using webFetch.',
      ...TASK_FORMAT_LINES,
    )
  }

  return lines.join('\n')
}
