import { CODING_TASKS } from './evaluate-agent-context-tasks-coding'
import { CONTEXT_TASKS } from './evaluate-agent-context-tasks-context'
import { PLATFORM_TASKS } from './evaluate-agent-context-tasks-platform'
import type { EvalTask } from './evaluate-agent-context-types'

/** Every task of `pnpm evaluate:agent-context`, in a stable order. */
export const AGENT_CONTEXT_TASKS: readonly EvalTask[] = [...CODING_TASKS, ...PLATFORM_TASKS, ...CONTEXT_TASKS]
