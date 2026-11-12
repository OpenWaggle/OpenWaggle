import { decodeUnknownOrThrow } from '@shared/schema'
import { actionInvocationSchema } from '@shared/schemas/action-definitions'
import {
  ACTION_DEFINITION_LIMITS,
  type ActionInvocation,
  type ResolvedActionInvocation,
} from '@shared/types/action-definitions'
import { projectTaskArguments } from '@shared/utils/project-task-command'
import { cargoAliasReader } from './cargo-alias-reader'
import { hatchScriptReader } from './hatch-script-reader'
import { packageScriptReader } from './package-script-reader'
import { type ProjectTaskReader, sameTaskReference } from './task-discovery-types'
import { resolveActionDirectory } from './task-source-files'

const READERS: readonly ProjectTaskReader[] = [
  packageScriptReader,
  hatchScriptReader,
  cargoAliasReader,
]

/** Fresh reads are intentional: a branch switch must never leave cached executable task bodies. */
export async function discoverProjectTasks(workspace: string) {
  const discoveries = await Promise.all(READERS.map((reader) => reader.list(workspace)))
  const tasks = discoveries.flatMap((discovery) => discovery.tasks)
  const diagnostics = discoveries.flatMap((discovery) => discovery.diagnostics)
  if (tasks.length > ACTION_DEFINITION_LIMITS.DISCOVERED_TASKS) {
    diagnostics.push({
      source: '.',
      message: 'Task discovery reached its size limit. Narrow the workspace package patterns.',
    })
  }
  return { tasks: tasks.slice(0, ACTION_DEFINITION_LIMITS.DISCOVERED_TASKS), diagnostics }
}

export async function resolveActionInvocation(workspace: string, input: ActionInvocation) {
  const invocation = decodeUnknownOrThrow(actionInvocationSchema, input)
  if (invocation.type === 'command') {
    const result: ResolvedActionInvocation = {
      type: 'command',
      command: invocation.command,
      cwd: await resolveActionDirectory(workspace, invocation.directory),
    }
    return result
  }
  const reference = invocation.task
  const reader = READERS.find((candidate) => candidate.provider === reference.provider)
  if (!reader) throw new Error(`Unsupported task provider: ${reference.provider}`)
  const discovery = await reader.list(workspace, reference)
  const task = discovery.tasks.find((candidate) =>
    sameTaskReference(candidate.reference, reference),
  )
  if (!task) {
    throw new Error(
      `Task unavailable: ${reference.source} · ${reference.task}. ${discovery.diagnostics.map((diagnostic) => diagnostic.message).join(' ')}`.trim(),
    )
  }
  if (task.runner === null) {
    throw new Error(task.unavailableReason ?? 'The project task runner could not be determined.')
  }
  const result: ResolvedActionInvocation = {
    type: 'executable',
    executable: task.runner,
    args: projectTaskArguments(reference),
    cwd: await resolveActionDirectory(workspace, reference.directory),
  }
  return result
}
