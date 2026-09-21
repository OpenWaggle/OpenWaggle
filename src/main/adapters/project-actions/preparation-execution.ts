import { randomUUID } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
import type { ActionInvocation } from '@shared/types/action-definitions'
import type { PreparationPhase } from '@shared/types/workspace-preparation'
import type { ActionRunWorkspace } from '../../ports/action-run-service'
import { createTerminalHistorySanitizer } from '../terminal/terminal-history-sanitizer'
import type { PreparationDependencies } from './managed-workspace-preparation'
import type { StoredWorkspacePreparation } from './preparation-persistence'
import { EMPTY_PREPARATION_EXECUTION } from './workspace-preparation-model'

const OUTPUT_CHARACTERS = 128 * 1_024
const OUTPUT_CHECKPOINT_MS = 1_000
export async function executeWorkspacePreparation(input: {
  readonly workspace: ActionRunWorkspace
  readonly previous: StoredWorkspacePreparation
  readonly phase: PreparationPhase
  readonly invocation: ActionInvocation
  readonly deps: PreparationDependencies
  readonly publish: (state: StoredWorkspacePreparation | null) => void
  readonly onStarted?: (state: StoredWorkspacePreparation) => Promise<void>
}) {
  const { workspace, previous, phase, invocation, deps, publish } = input
  let state: StoredWorkspacePreparation = {
    ...previous,
    revision: previous.revision + 1,
    [phase]: {
      ...EMPTY_PREPARATION_EXECUTION,
      status: 'running',
      attemptId: randomUUID(),
      startedAt: Date.now(),
    },
  }
  await deps.persistence.write(state, previous.revision)
  publish(state)
  const release = deps.acquireLiveness()
  const sanitizer = createTerminalHistorySanitizer()
  let writes = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | undefined
  const checkpoint = () => {
    const expectedRevision = state.revision
    state = { ...state, revision: expectedRevision + 1 }
    const snapshot = state
    publish(state)
    writes = writes.then(() => deps.persistence.write(snapshot, expectedRevision))
    // The final await propagates persistence failure; this handler prevents unhandled rejection during execution.
    void writes.catch(() => {})
  }
  try {
    await input.onStarted?.(state)
    const result = await deps.execute({
      workspace,
      invocation,
      environment: state.environment,
      captureEnvironment: phase === 'setup',
      onOutput: (chunk) => {
        const output = state[phase].output + stripVTControlCharacters(sanitizer.feed(chunk))
        state = {
          ...state,
          [phase]: {
            ...state[phase],
            output: output.slice(-OUTPUT_CHARACTERS),
            truncated: state[phase].truncated || output.length > OUTPUT_CHARACTERS,
          },
        }
        publish(state)
        timer ??= setTimeout(() => {
          timer = undefined
          checkpoint()
        }, OUTPUT_CHECKPOINT_MS)
      },
    })
    state = {
      ...state,
      environment:
        result.exitCode === 0 && phase === 'setup' ? result.environment : state.environment,
      [phase]: {
        ...state[phase],
        status: result.exitCode === 0 ? 'succeeded' : 'failed',
        exitCode: result.exitCode,
        finishedAt: Date.now(),
        error:
          result.exitCode === 0
            ? null
            : `${phase} exited with code ${result.exitCode ?? 'unknown'}.`,
      },
    }
  } catch (error) {
    state = {
      ...state,
      [phase]: {
        ...state[phase],
        status: 'failed',
        finishedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      },
    }
  } finally {
    if (timer) clearTimeout(timer)
    try {
      checkpoint()
      await writes
    } finally {
      publish(null)
      release()
    }
  }
  return state
}
