import { safeDecodeUnknown } from '@shared/schema'
import { commandRepairProposalSchema } from '@shared/schemas/action-definitions'
import {
  type ActionDefinition,
  COMMAND_REPAIR_PROPOSAL_TYPE,
  type CommandRepairProposal,
  type ProjectTaskDiscovery,
} from '@shared/types/action-definitions'
import { projectTaskArguments } from '@shared/utils/project-task-command'
import * as Effect from 'effect/Effect'
import type { ActionCatalogServiceShape } from '../../ports/action-catalog-service'
import type { ActionRunWorkspace } from '../../ports/action-run-service'

interface RepairProposalArguments {
  readonly actionId: string
  readonly command: string
  readonly directory?: string
  readonly reason: string
}

function currentCommand(definition: ActionDefinition, discovery: ProjectTaskDiscovery) {
  const invocation = definition.invocation
  if (invocation.type === 'command')
    return { command: invocation.command, directory: invocation.directory, resolved: true }
  const task = discovery.tasks.find(
    ({ reference }) =>
      reference.provider === invocation.task.provider &&
      reference.source === invocation.task.source &&
      reference.task === invocation.task.task &&
      reference.directory === invocation.task.directory,
  )
  // Never invent a command the action did not run: an unresolved script is named, not guessed.
  const { directory } = invocation.task
  if (!task?.runner)
    return {
      command: `the ${invocation.task.task} script in ${invocation.task.source}`,
      directory,
      resolved: false,
    }
  return {
    command: [task.runner, ...projectTaskArguments(invocation.task)].join(' '),
    directory,
    resolved: true,
  }
}

/** Only data: the user reviews and saves the proposal in the action panel (ADR 0038). */
export async function proposeRepair(input: {
  readonly catalog: Pick<ActionCatalogServiceShape, 'read' | 'discover'>
  readonly workspace: ActionRunWorkspace
  readonly proposal: RepairProposalArguments
}): Promise<CommandRepairProposal> {
  const { workspace, proposal: params } = input
  const catalog = await Effect.runPromise(input.catalog.read(workspace))
  const definition = catalog.actions.find(
    (entry) => entry.definition.id === params.actionId,
  )?.definition
  if (!definition) throw new Error('Saved action not found. Use list to inspect available actions.')
  const discovery =
    definition.invocation.type === 'task'
      ? await Effect.runPromise(input.catalog.discover(workspace.workspacePath))
      : { tasks: [], diagnostics: [] }
  const current = currentCommand(definition, discovery)
  const decoded = safeDecodeUnknown(commandRepairProposalSchema, {
    type: COMMAND_REPAIR_PROPOSAL_TYPE,
    actionId: definition.id,
    actionName: definition.name,
    current,
    proposed: { command: params.command.trim(), directory: params.directory ?? current.directory },
    reason: params.reason.trim(),
  })
  if (!decoded.success) {
    // The only field the agent chooses that can fail beyond blank text is the directory.
    const directoryHint =
      params.directory !== undefined
        ? ' The directory must be relative to the project, such as "." or "packages/app".'
        : ''
    throw new Error(
      `Invalid project_actions arguments for "propose": ${decoded.issues.join('; ')}.${directoryHint}`,
    )
  }
  return decoded.data
}
