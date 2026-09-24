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
  readonly signal?: AbortSignal
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
  let persistedRevision = state.revision
  let writes = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | undefined
  const checkpoint = (snapshot: StoredWorkspacePreparation) => {
    writes = writes
      .catch(() => {})
      .then(async () => {
        // A failed checkpoint must not poison later writes or advance their comparison revision.
        const revision = persistedRevision + 1
        await deps.persistence.write({ ...snapshot, revision }, persistedRevision)
        persistedRevision = revision
        state = { ...state, revision }
        if (state[phase].status === 'running') publish(state)
      })
    // The final await propagates persistence failure; this handler prevents unhandled rejection during execution.
    void writes.catch(() => {})
  }
  try {
    await input.onStarted?.(state)
    input.signal?.throwIfAborted()
    const result = await deps.execute({
      workspace,
      invocation,
      environment: state.environment,
      captureEnvironment: phase === 'setup',
      signal: input.signal,
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
          checkpoint(state)
        }, OUTPUT_CHECKPOINT_MS)
      },
    })
    input.signal?.throwIfAborted()
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
  }
  if (timer) clearTimeout(timer)
  try {
    checkpoint(state)
    await writes
    publish(null)
  } catch (error) {
    // Keep recovery controls available even while storage cannot accept the final result.
    state = {
      ...state,
      revision: persistedRevision,
      environment: previous.environment,
      [phase]: {
        ...state[phase],
        status: 'failed',
        finishedAt: Date.now(),
        error: `Could not save the preparation result: ${error instanceof Error ? error.message : String(error)}`,
      },
    }
    publish(state)
    throw error
  } finally {
    release()
  }
  return state
}
