import { TERMINAL } from '@shared/constants/resource-limits'
import type { WorktreeSetupActionTerminal } from '@shared/types/background-run'
import type { ProjectAction } from '@shared/types/project-actions'
import { createProjectActionTerminalEnvironment } from '@shared/utils/terminal-environment'
import * as Effect from 'effect/Effect'
import { listProjectActions } from '../../../config/project-actions'
import type { TerminalServiceShape } from '../../../ports/terminal-service'

type ListProjectActions = (projectPath: string) => Promise<readonly ProjectAction[]>

export type ProjectSetupActionLaunchResult =
  | { readonly status: 'no-action' }
  | {
      readonly status: 'started'
      readonly setupAction: WorktreeSetupActionTerminal
    }

export interface ProjectSetupActionLaunchInput {
  readonly sessionId: string
  readonly primaryPath: string
  readonly worktreePath: string
  /** Durable identity of this Session worktree incarnation's Setup dispatch. */
  readonly setupGeneration: string
  readonly terminal: TerminalServiceShape
  readonly signal?: AbortSignal
  /** Called after `open` accepts the terminal and before command delivery. */
  readonly onTerminalOpened?: (setupAction: WorktreeSetupActionTerminal) => void
  readonly listActions?: ListProjectActions
}

function launchError(action: ProjectAction, message: string) {
  return new Error(`Setup action "${action.name}" ${message}`)
}

async function closeFailedSetupTerminal(
  input: ProjectSetupActionLaunchInput,
  terminalId: string,
  originalError: unknown,
): Promise<never> {
  try {
    await Effect.runPromise(input.terminal.close(input.sessionId, terminalId, true))
  } catch (cleanupError) {
    throw new AggregateError(
      [originalError, cleanupError],
      'Setup action failed and its terminal could not be closed.',
      { cause: cleanupError },
    )
  }
  throw originalError
}

async function queueSetupCommand(
  input: ProjectSetupActionLaunchInput,
  action: ProjectAction,
  terminalId: string,
) {
  input.signal?.throwIfAborted()
  const write = await Effect.runPromise(
    input.terminal.write(
      input.sessionId,
      terminalId,
      `${action.command}\r`,
      { generation: terminalId, sequence: 0 },
      {
        kind: 'project-action',
        executionId: `setup:${input.setupGeneration}:${action.id}`,
      },
    ),
  )
  if (write.status === 'rejected') {
    throw launchError(action, `command was rejected (${write.reason}).`)
  }
}

/** Open and queue a durably claimed worktree generation's sole Setup action. */
export async function launchProjectSetupAction(
  input: ProjectSetupActionLaunchInput,
): Promise<ProjectSetupActionLaunchResult> {
  input.signal?.throwIfAborted()
  const actions = await (input.listActions ?? listProjectActions)(input.primaryPath)
  input.signal?.throwIfAborted()
  const action = actions.find((candidate) => candidate.runOnWorktreeCreate)
  if (!action) return { status: 'no-action' }

  const terminalId = `setup-${action.id}`
  const setupAction = {
    terminalId,
    actionId: action.id,
    actionName: action.name,
    projectRoot: input.primaryPath,
    cwd: input.worktreePath,
  } satisfies WorktreeSetupActionTerminal
  input.signal?.throwIfAborted()
  const opened = await Effect.runPromise(
    input.terminal.open({
      ownerKey: input.sessionId,
      terminalId,
      cwd: input.worktreePath,
      cols: TERMINAL.DEFAULT_COLS,
      rows: TERMINAL.DEFAULT_ROWS,
      inputGeneration: terminalId,
      env: createProjectActionTerminalEnvironment({
        projectRoot: input.primaryPath,
        worktreePath: input.worktreePath,
      }),
    }),
  )
  if (!opened.running) throw launchError(action, 'terminal did not open.')

  try {
    input.signal?.throwIfAborted()
    input.onTerminalOpened?.(setupAction)
    await queueSetupCommand(input, action, terminalId)
  } catch (error) {
    return closeFailedSetupTerminal(input, terminalId, error)
  }
  return { status: 'started', setupAction }
}
