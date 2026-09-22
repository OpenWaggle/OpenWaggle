import { decodeUnknownOrThrow } from '@shared/schema'
import { actionInvocationSchema } from '@shared/schemas/action-definitions'
import {
  ACTION_DEFINITION_LIMITS,
  type ActionInvocation,
  type ProjectTaskDiscovery,
  type ProjectTaskReference,
  type ResolvedActionInvocation,
} from '@shared/types/action-definitions'
import { projectTaskArguments } from '@shared/utils/project-task-command'
import { cargoAliasReader } from './cargo-alias-reader'
import { hatchScriptReader } from './hatch-script-reader'
import { packageScriptReader } from './package-script-reader'
import type { ProjectTaskReader } from './task-discovery-types'
import { resolveActionDirectory } from './task-source-files'

const READERS: readonly ProjectTaskReader[] = [
  packageScriptReader,
  hatchScriptReader,
  cargoAliasReader,
]

/** Fresh reads are intentional: a branch switch must never leave cached executable task bodies. */
export async function discoverProjectTasks(workspace: string): Promise<ProjectTaskDiscovery> {
  const discoveries = await Promise.all(READERS.map((reader) => reader.list(workspace)))
  const tasks = discoveries.flatMap((discovery) => discovery.tasks)
  const diagnostics = discoveries.flatMap((discovery) => discovery.diagnostics)
  if (tasks.length > ACTION_DEFINITION_LIMITS.DISCOVERED_TASKS)
    diagnostics.push({
      source: workspace,
      message: 'Task discovery reached its size limit. Narrow the workspace package patterns.',
    })
  return { tasks: tasks.slice(0, ACTION_DEFINITION_LIMITS.DISCOVERED_TASKS), diagnostics }
}

function sameReference(left: ProjectTaskReference, right: ProjectTaskReference) {
  return (
    left.provider === right.provider &&
    left.source === right.source &&
    left.task === right.task &&
    left.directory === right.directory &&
    left.environment === right.environment
  )
}

export async function resolveActionInvocation(
  workspace: string,
  input: ActionInvocation,
): Promise<ResolvedActionInvocation> {
  const invocation = decodeUnknownOrThrow(actionInvocationSchema, input)
  if (invocation.type === 'command')
    return {
      type: 'command',
      command: invocation.command,
      cwd: await resolveActionDirectory(workspace, invocation.directory),
    }
  const reference = invocation.task
  const reader = READERS.find((candidate) => candidate.provider === reference.provider)
  if (!reader) throw new Error(`Unsupported task provider: ${reference.provider}`)
  const discovery = await reader.list(workspace)
  const task = discovery.tasks.find((candidate) => sameReference(candidate.reference, reference))
  if (!task)
    throw new Error(
      `Task unavailable: ${reference.source} · ${reference.task}. ${discovery.diagnostics.map((diagnostic) => diagnostic.message).join(' ')}`.trim(),
    )
  if (task.runner === null)
    throw new Error(task.unavailableReason ?? 'The project task runner could not be determined.')
  return {
    type: 'executable',
    executable: task.runner,
    args: projectTaskArguments(reference),
    cwd: await resolveActionDirectory(workspace, reference.directory),
  }
}
